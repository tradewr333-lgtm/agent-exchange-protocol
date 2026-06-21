// Hire-this-agent — the bridge from simulated credits to REAL revenue.
//
// A real customer pays (BNB/USDT/USDC on BSC) to hire an agent for a one-off task.
// The agent does the work with Claude; the owner is paid their share on-chain and
// AXP keeps a platform fee. computeSplit + buildHireQuote are pure (testable);
// the on-chain verify + payout live in payments-onchain.js / payout.js.

import { TOKENS } from './payments-onchain.js';

export const HIRE_FEE_RATE = 0.2; // AXP takes 20%; the agent owner keeps 80%.

export function hireAmounts(env = process.env) {
  return {
    USDT: Number(env.AXP_HIRE_PRICE_USDT || 3),
    USDC: Number(env.AXP_HIRE_PRICE_USDC || 3),
    BNB: Number(env.AXP_HIRE_PRICE_BNB || 0.005),
  };
}

export function hireFeeRate(env = process.env) {
  const r = Number(env.AXP_HIRE_FEE_RATE);
  return Number.isFinite(r) && r >= 0 && r < 1 ? r : HIRE_FEE_RATE;
}

// Split a paid amount between the AXP platform fee and the agent owner.
export function computeSplit(amount, feeRate = HIRE_FEE_RATE) {
  const a = Number(amount);
  if (!Number.isFinite(a) || a <= 0) return { fee: 0, owner: 0 };
  const fee = Number((a * feeRate).toFixed(8));
  const owner = Number((a - fee).toFixed(8));
  return { fee, owner };
}

export function hirePaymentEnabled(env = process.env) {
  return Boolean(env.AXP_TREASURY_ADDRESS);
}

export function buildHireQuote(env = process.env) {
  const treasury = env.AXP_TREASURY_ADDRESS || null;
  const amounts = hireAmounts(env);
  return {
    protocol: 'AXP',
    schema: 'axp.hire_quote.v0',
    enabled: Boolean(treasury),
    chain: 'BNB Smart Chain',
    chain_id: 56,
    treasury,
    usd: amounts.USDT,
    fee_rate: hireFeeRate(env),
    options: [
      { asset: 'USDT', amount: amounts.USDT, token_address: TOKENS.USDT.address, decimals: TOKENS.USDT.decimals },
      { asset: 'USDC', amount: amounts.USDC, token_address: TOKENS.USDC.address, decimals: TOKENS.USDC.decimals },
      { asset: 'BNB', amount: amounts.BNB, token_address: null, decimals: 18 },
    ],
    note: treasury
      ? 'Pay the exact amount to the treasury, then POST /agents/{id}/hire with the tx hash and your task.'
      : 'Hiring is not configured (set AXP_TREASURY_ADDRESS).',
  };
}
