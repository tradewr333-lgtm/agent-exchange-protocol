// x402 — internet-native pay-per-call for AXP agents.
//
// Each hosted agent is exposed as a paid HTTP endpoint. A caller (human OR another
// autonomous agent) that requests it without payment gets HTTP 402 + a standard
// `PaymentRequired` object describing how to pay (USDC, network, amount, payTo = the
// agent OWNER's wallet). The caller pays on-chain, retries with proof, and the agent
// runs the task and returns the result. This flips the model: instead of hunting for
// work, the agent's skill becomes a self-serve API that earns USDC per call.
//
// Standard ref: https://x402.org  (HTTP 402, base64-JSON payment headers).
// Pure helpers here are network-free and unit-tested; settlement verification lives in
// payments-onchain.verifyErc20TransferTo (chain-agnostic).

export const X402_VERSION = 1;

// Network presets: USDC contract + decimals + RPC + chainId. x402's canonical network
// is Base; BSC is included because AXP already settles there. Override via env.
export const X402_NETWORKS = {
  base: { chain_id: 8453, usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6, rpc: 'https://mainnet.base.org' },
  bsc: { chain_id: 56, usdc: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18, rpc: 'https://bsc-dataseed.binance.org' },
};

export function x402Network(env = process.env) {
  const key = (env.AXP_X402_NETWORK || 'base').toLowerCase();
  const preset = X402_NETWORKS[key] || X402_NETWORKS.base;
  return {
    name: key in X402_NETWORKS ? key : 'base',
    chain_id: Number(env.AXP_X402_CHAIN_ID || preset.chain_id),
    usdc: env.AXP_X402_USDC || preset.usdc,
    decimals: Number(env.AXP_X402_USDC_DECIMALS || preset.decimals),
    rpc: env.AXP_X402_RPC || preset.rpc,
  };
}

export function pricePerCallUsd(env = process.env) {
  const n = Number(env.AXP_X402_PRICE_USD);
  return Number.isFinite(n) && n > 0 ? n : 0.05; // default 5¢/call
}

// x402 is "enabled" once a price exists (always true by default) — the agent must also
// have an owner wallet to receive funds (checked per-agent in buildPaymentRequired).
export function x402Enabled(env = process.env) {
  return pricePerCallUsd(env) > 0;
}

// USD → atomic units string for the token's decimals (no float drift).
export function toAtomic(usd, decimals) {
  const [whole, frac = ''] = String(usd).split('.');
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return `${BigInt(`${whole}${fracPadded}`)}`;
}

export const encodeHeader = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
export function decodeHeader(b64) {
  try { return JSON.parse(Buffer.from(String(b64), 'base64').toString('utf8')); }
  catch { return null; }
}

// Build the standard x402 PaymentRequired object for an agent's paid endpoint.
export function buildPaymentRequired({ agent, resource, env = process.env } = {}) {
  const net = x402Network(env);
  const price = pricePerCallUsd(env);
  const service = (agent?.services || [])[0] || agent?.template || 'task';
  return {
    x402Version: X402_VERSION,
    accepts: [
      {
        scheme: 'exact',
        network: net.name,
        maxAmountRequired: toAtomic(price, net.decimals),
        resource,
        description: `Run the ${agent?.name || 'AXP'} agent (${service}) once and return the result.`,
        mimeType: 'application/json',
        payTo: agent?.owner || null,
        maxTimeoutSeconds: 120,
        asset: net.usdc,
        extra: { name: 'USD Coin', symbol: 'USDC', version: '2', price_usd: price },
      },
    ],
    error: 'X-PAYMENT required: pay the quoted USDC to payTo, then retry with proof.',
  };
}

// Pull the payment proof from x402 headers (v2 `PAYMENT-SIGNATURE`, v1 `X-PAYMENT`) or
// a JSON body fallback. AXP accepts a settled on-chain tx hash as proof (MVP).
export function extractPaymentProof({ headers = {}, body = {} } = {}) {
  const raw = headers['payment-signature'] || headers['x-payment'] || null;
  if (raw) {
    const decoded = decodeHeader(raw);
    if (decoded) return decoded;
  }
  if (body && (body.tx_hash || body.payment)) return body.payment || body;
  return null;
}
