// On-chain payment for the one-time Agent Launch fee (paid via MetaMask on BSC).
//
// The buyer pays the AXP treasury in BNB / USDT / USDC, then submits the tx hash.
// The server verifies on-chain that the payment is real (correct recipient, asset,
// amount, and confirmed) before launching the agent. Verification uses a BSC RPC
// (env BSC_RPC_URL); amounts are configured (no price oracle needed).
//
// Pure helpers (buildLaunchQuote) are testable without network.

const BSC_CHAIN_ID = 56;

// BEP-20 stablecoins on BSC (both 18 decimals on BSC).
export const TOKENS = {
  USDT: { address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
  USDC: { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
};

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

function launchAmounts(env = process.env) {
  return {
    USDT: Number(env.AXP_LAUNCH_PRICE_USDT || 49),
    USDC: Number(env.AXP_LAUNCH_PRICE_USDC || 49),
    BNB: Number(env.AXP_LAUNCH_PRICE_BNB || 0.08),
  };
}

export function launchPaymentEnabled(env = process.env) {
  return Boolean(env.AXP_TREASURY_ADDRESS);
}

export function buildLaunchQuote(env = process.env) {
  const treasury = env.AXP_TREASURY_ADDRESS || null;
  const amounts = launchAmounts(env);
  return {
    protocol: 'AXP',
    schema: 'axp.launch_quote.v0',
    enabled: Boolean(treasury),
    chain: 'BNB Smart Chain',
    chain_id: BSC_CHAIN_ID,
    treasury,
    usd: 49,
    options: [
      { asset: 'USDT', amount: amounts.USDT, token_address: TOKENS.USDT.address, decimals: TOKENS.USDT.decimals },
      { asset: 'USDC', amount: amounts.USDC, token_address: TOKENS.USDC.address, decimals: TOKENS.USDC.decimals },
      { asset: 'BNB', amount: amounts.BNB, token_address: null, decimals: 18 },
    ],
    note: treasury
      ? 'Pay the exact amount of one asset to the treasury, then POST /agents/launch with the tx hash.'
      : 'Launch payments are not configured (set AXP_TREASURY_ADDRESS).',
  };
}

function toBaseUnits(amount, decimals) {
  // Multiply with string math to avoid float drift, then BigInt.
  const [whole, frac = ''] = String(amount).split('.');
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(`${whole}${fracPadded}`);
}

// Generic: verify a payment to the AXP treasury on BSC for required per-asset amounts.
export async function verifyTreasuryPayment({ tx_hash, asset, amounts } = {}, env = process.env) {
  const treasury = env.AXP_TREASURY_ADDRESS;
  if (!treasury) return { ok: false, status: 503, error: 'treasury_not_configured' };
  if (typeof tx_hash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(tx_hash)) {
    return { ok: false, status: 400, error: 'tx_hash_invalid' };
  }
  const assetUp = String(asset || '').toUpperCase();
  if (!['BNB', 'USDT', 'USDC'].includes(assetUp)) {
    return { ok: false, status: 400, error: 'asset_invalid' };
  }

  const rpc = env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org';
  let provider;
  try {
    const { JsonRpcProvider } = await import('ethers');
    provider = new JsonRpcProvider(rpc, BSC_CHAIN_ID);
  } catch {
    return { ok: false, status: 503, error: 'rpc_unavailable' };
  }

  const treasuryLc = treasury.toLowerCase();

  try {
    const [tx, receipt] = await Promise.all([
      provider.getTransaction(tx_hash),
      provider.getTransactionReceipt(tx_hash),
    ]);
    if (!tx || !receipt) return { ok: false, status: 400, error: 'tx_not_found' };
    if (receipt.status !== 1) return { ok: false, status: 400, error: 'tx_failed' };

    if (assetUp === 'BNB') {
      if ((tx.to || '').toLowerCase() !== treasuryLc) return { ok: false, status: 400, error: 'wrong_recipient' };
      const required = toBaseUnits(amounts.BNB, 18);
      if (BigInt(tx.value) < required) return { ok: false, status: 400, error: 'insufficient_amount' };
      return { ok: true, verified: true, asset: 'BNB', amount: amounts.BNB, tx_hash };
    }

    // ERC-20 (USDT/USDC): find a Transfer log to the treasury for >= required amount.
    const token = TOKENS[assetUp];
    const required = toBaseUnits(amounts[assetUp], token.decimals);
    const tokenLc = token.address.toLowerCase();
    const padded = `0x000000000000000000000000${treasuryLc.slice(2)}`;
    const match = (receipt.logs || []).find((log) =>
      (log.address || '').toLowerCase() === tokenLc &&
      (log.topics?.[0] || '').toLowerCase() === TRANSFER_TOPIC &&
      (log.topics?.[2] || '').toLowerCase() === padded &&
      BigInt(log.data) >= required);
    if (!match) return { ok: false, status: 400, error: 'transfer_not_found_or_insufficient' };
    return { ok: true, verified: true, asset: assetUp, amount: amounts[assetUp], tx_hash };
  } catch (err) {
    return { ok: false, status: 502, error: 'verification_failed', detail: err?.message || String(err) };
  }
}

// Generic ERC-20/USDC transfer verifier to an ARBITRARY recipient on ANY EVM chain.
// Used by x402 pay-per-call: the caller pays the agent owner directly, and we confirm
// the on-chain Transfer log (recipient + amount) before running the agent.
export async function verifyErc20TransferTo({ tx_hash, token_address, decimals, min_amount_usd, recipient, rpc, chain_id } = {}) {
  if (typeof tx_hash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(tx_hash)) {
    return { ok: false, status: 400, error: 'tx_hash_invalid' };
  }
  if (typeof recipient !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(recipient)) {
    return { ok: false, status: 400, error: 'recipient_invalid' };
  }
  if (typeof token_address !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(token_address)) {
    return { ok: false, status: 400, error: 'token_invalid' };
  }
  let provider;
  try {
    const { JsonRpcProvider } = await import('ethers');
    provider = new JsonRpcProvider(rpc, chain_id);
  } catch {
    return { ok: false, status: 503, error: 'rpc_unavailable' };
  }
  try {
    const receipt = await provider.getTransactionReceipt(tx_hash);
    if (!receipt) return { ok: false, status: 400, error: 'tx_not_found' };
    if (receipt.status !== 1) return { ok: false, status: 400, error: 'tx_failed' };
    const required = toBaseUnits(min_amount_usd, decimals);
    const tokenLc = token_address.toLowerCase();
    const padded = `0x000000000000000000000000${recipient.toLowerCase().slice(2)}`;
    const match = (receipt.logs || []).find((log) =>
      (log.address || '').toLowerCase() === tokenLc &&
      (log.topics?.[0] || '').toLowerCase() === TRANSFER_TOPIC &&
      (log.topics?.[2] || '').toLowerCase() === padded &&
      BigInt(log.data) >= required);
    if (!match) return { ok: false, status: 402, error: 'payment_not_found_or_insufficient' };
    return { ok: true, verified: true, tx_hash, recipient, amount_usd: Number(min_amount_usd) };
  } catch (err) {
    return { ok: false, status: 502, error: 'verification_failed', detail: err?.message || String(err) };
  }
}

// Verify a launch payment (uses the configured launch amounts).
export async function verifyLaunchPayment(payment = {}, env = process.env) {
  if (!env.AXP_TREASURY_ADDRESS) return { ok: false, status: 503, error: 'launch_payments_disabled' };
  return verifyTreasuryPayment({ ...payment, amounts: launchAmounts(env) }, env);
}
