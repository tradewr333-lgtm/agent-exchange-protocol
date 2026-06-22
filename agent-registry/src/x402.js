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
  'base-sepolia': { chain_id: 84532, usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', decimals: 6, rpc: 'https://sepolia.base.org' },
  bsc: { chain_id: 56, usdc: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18, rpc: 'https://bsc-dataseed.binance.org' },
};

function resolveNet(key) {
  const k = String(key || '').toLowerCase();
  const preset = X402_NETWORKS[k];
  if (!preset) return null;
  return { name: k, chain_id: preset.chain_id, usdc: preset.usdc, decimals: preset.decimals, rpc: preset.rpc };
}

// All networks an agent accepts payment on. Multi-rail by default (BSC + Base) so a
// buyer pays on whichever chain they hold USDC. Override with AXP_X402_NETWORKS="bsc,base"
// (or a single AXP_X402_NETWORK for back-compat).
export function x402NetworkList(env = process.env) {
  const raw = env.AXP_X402_NETWORKS || env.AXP_X402_NETWORK || 'base,bsc';
  const list = raw.split(',').map((s) => resolveNet(s)).filter(Boolean);
  return list.length ? list : [resolveNet('base')];
}

// Primary network (first in the list) — for single-network callers / labels.
export function x402Network(env = process.env) {
  return x402NetworkList(env)[0];
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

// Build the standard x402 PaymentRequired object — one `accepts` entry PER network
// (multi-rail: the buyer picks whichever chain they hold USDC on).
export function buildPaymentRequired({ agent, resource, env = process.env } = {}) {
  const price = pricePerCallUsd(env);
  const service = (agent?.services || [])[0] || agent?.template || 'task';
  const accepts = x402NetworkList(env).map((net) => ({
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
  }));
  return {
    x402Version: X402_VERSION,
    accepts,
    error: 'X-PAYMENT required: pay the quoted USDC to payTo on any listed network, then retry with proof.',
  };
}

// Pull the payment proof from x402 headers (v2 `PAYMENT-SIGNATURE`, v1 `X-PAYMENT`) or
// a JSON body fallback. The proof is EITHER a signed PaymentPayload (facilitator flow,
// Phase 2) OR a settled on-chain tx hash (self-verify flow, Phase 1).
export function extractPaymentProof({ headers = {}, body = {} } = {}) {
  const raw = headers['payment-signature'] || headers['x-payment'] || null;
  if (raw) {
    const decoded = decodeHeader(raw);
    if (decoded) return decoded;
  }
  if (body && (body.tx_hash || body.payment)) return body.payment || body;
  return null;
}

// A signed x402 PaymentPayload (scheme `exact` = EIP-3009 transferWithAuthorization),
// as opposed to a bare { tx_hash }. The facilitator verifies + settles these.
export function isSignedPayload(proof) {
  return Boolean(proof && proof.scheme && (proof.payload || proof.authorization));
}

// ---------------------------------------------------------------------------
// Phase 2 — facilitator: verify + settle a signed payment in ONE round trip,
// so a caller (human or autonomous agent) pays without any pre-funded tx.
// Configure AXP_X402_FACILITATOR_URL (e.g. testnet https://x402.org/facilitator,
// or a Base mainnet facilitator). Optional AXP_X402_FACILITATOR_KEY for hosted ones.
// ---------------------------------------------------------------------------
// Default to a public Base mainnet facilitator (PayAI, no API key) so autonomous
// single-call settlement works out of the box. Override with AXP_X402_FACILITATOR_URL.
export const DEFAULT_FACILITATOR_URL = 'https://facilitator.payai.network';
export function facilitatorUrl(env = process.env) {
  return (env.AXP_X402_FACILITATOR_URL || DEFAULT_FACILITATOR_URL).replace(/\/$/, '') || null;
}
export function facilitatorEnabled(env = process.env) {
  return Boolean(facilitatorUrl(env));
}

async function postFacilitator(path, payload, env, fetchImpl) {
  const url = facilitatorUrl(env);
  if (!url) return { ok: false, error: 'facilitator_not_configured' };
  const doFetch = fetchImpl ?? globalThis.fetch;
  const headers = { 'Content-Type': 'application/json' };
  if (env.AXP_X402_FACILITATOR_KEY) headers.Authorization = `Bearer ${env.AXP_X402_FACILITATOR_KEY}`;
  try {
    const res = await doFetch(`${url}${path}`, { method: 'POST', headers, body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, error: 'facilitator_unreachable', detail: String(err?.message || err) };
  }
}

export async function verifyViaFacilitator({ paymentPayload, paymentRequirements, env = process.env, fetchImpl } = {}) {
  const r = await postFacilitator('/verify', { x402Version: X402_VERSION, paymentPayload, paymentRequirements }, env, fetchImpl);
  if (!r.ok) return { ok: false, status: r.status || 502, error: r.error || 'verify_failed', detail: r.detail, data: r.data };
  const isValid = Boolean(r.data?.isValid);
  return { ok: isValid, isValid, invalidReason: r.data?.invalidReason || null, payer: r.data?.payer || null, data: r.data };
}

export async function settleViaFacilitator({ paymentPayload, paymentRequirements, env = process.env, fetchImpl } = {}) {
  const r = await postFacilitator('/settle', { x402Version: X402_VERSION, paymentPayload, paymentRequirements }, env, fetchImpl);
  if (!r.ok) return { ok: false, status: r.status || 502, error: r.error || 'settle_failed', detail: r.detail, data: r.data };
  const success = Boolean(r.data?.success);
  return { ok: success, success, transaction: r.data?.transaction || null, payer: r.data?.payer || null, errorReason: r.data?.errorReason || null, data: r.data };
}
