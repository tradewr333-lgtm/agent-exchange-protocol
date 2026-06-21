// On-chain payout to an agent owner's wallet (BSC).
//
// After a customer's hire payment is verified, the owner's share is sent here from
// a custodial payout wallet (env AXP_PAYOUT_PRIVATE_KEY). If the key isn't set, the
// caller records the earning as a pending balance instead of failing the job.
//
// The key is read from the environment only — never hardcoded. Runs on the server
// (which has network); set AXP_PAYOUT_PRIVATE_KEY on Render to enable real payouts.

const TRANSFER_SELECTOR = '0xa9059cbb'; // ERC-20 transfer(address,uint256)
const BSC_CHAIN_ID = 56;

const TOKEN_ADDRESS = {
  USDT: '0x55d398326f99059fF775485246999027B3197955',
  USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
};

export function payoutEnabled(env = process.env) {
  return Boolean(env.AXP_PAYOUT_PRIVATE_KEY);
}

export async function sendPayout({ to, asset, amount } = {}, env = process.env) {
  const pk = env.AXP_PAYOUT_PRIVATE_KEY;
  if (!pk) return { ok: false, reason: 'payout_not_configured' };
  if (!/^0x[a-fA-F0-9]{40}$/.test(to || '')) return { ok: false, reason: 'invalid_recipient' };
  const assetUp = String(asset || '').toUpperCase();
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return { ok: false, reason: 'invalid_amount' };

  try {
    const { JsonRpcProvider, Wallet, parseUnits } = await import('ethers');
    const provider = new JsonRpcProvider(env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org', BSC_CHAIN_ID);
    const wallet = new Wallet(pk, provider);

    if (assetUp === 'BNB') {
      const tx = await wallet.sendTransaction({ to, value: parseUnits(String(amt), 18) });
      const rec = await tx.wait(1);
      return { ok: rec?.status === 1, tx_hash: tx.hash };
    }

    const token = TOKEN_ADDRESS[assetUp];
    if (!token) return { ok: false, reason: 'unsupported_asset' };
    const value = parseUnits(String(amt), 18); // BSC USDT/USDC are 18 decimals
    const data = TRANSFER_SELECTOR
      + to.toLowerCase().replace(/^0x/, '').padStart(64, '0')
      + value.toString(16).padStart(64, '0');
    const tx = await wallet.sendTransaction({ to: token, data });
    const rec = await tx.wait(1);
    return { ok: rec?.status === 1, tx_hash: tx.hash };
  } catch (err) {
    return { ok: false, reason: 'payout_failed', detail: err?.message || String(err) };
  }
}
