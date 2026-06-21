import assert from 'node:assert';
import {
  buildPaymentRequired, x402Network, pricePerCallUsd, toAtomic,
  encodeHeader, decodeHeader, extractPaymentProof, x402Enabled,
  isSignedPayload, facilitatorEnabled, verifyViaFacilitator, settleViaFacilitator,
} from '../src/x402.js';

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed += 1; };

// --- price + atomic units ---
ok(pricePerCallUsd({}) === 0.05, 'default price is $0.05/call');
ok(pricePerCallUsd({ AXP_X402_PRICE_USD: '0.25' }) === 0.25, 'price from env');
ok(x402Enabled({}) === true, 'x402 enabled by default');
ok(toAtomic(0.05, 6) === '50000', '0.05 USDC at 6 decimals = 50000 atomic');
ok(toAtomic(1, 18) === '1000000000000000000', '1 USDC at 18 decimals');
ok(toAtomic(2.5, 6) === '2500000', '2.5 USDC at 6 decimals');

// --- network presets ---
const net = x402Network({});
ok(net.name === 'base' && net.chain_id === 8453 && net.decimals === 6, 'default network = Base (USDC 6 dec)');
const bsc = x402Network({ AXP_X402_NETWORK: 'bsc' });
ok(bsc.name === 'bsc' && bsc.chain_id === 56 && bsc.decimals === 18, 'bsc preset');
ok(x402Network({ AXP_X402_NETWORK: 'nonsense' }).name === 'base', 'unknown network falls back to base');
const sep = x402Network({ AXP_X402_NETWORK: 'base-sepolia' });
ok(sep.name === 'base-sepolia' && sep.chain_id === 84532 && sep.decimals === 6, 'base-sepolia testnet preset');

// --- PaymentRequired object (x402 standard shape) ---
const pr = buildPaymentRequired({
  agent: { name: 'Code Review Agent', owner: '0xABCdef0000000000000000000000000000000001', services: ['code_review'], template: 'code_review' },
  resource: 'https://axp.network/x402/agents/x/call',
  env: {},
});
ok(pr.x402Version === 1, 'x402Version present');
ok(Array.isArray(pr.accepts) && pr.accepts.length === 1, 'one accepts entry');
ok(pr.accepts[0].scheme === 'exact', 'scheme = exact');
ok(pr.accepts[0].network === 'base', 'network = base');
ok(pr.accepts[0].payTo === '0xABCdef0000000000000000000000000000000001', 'payTo = agent owner');
ok(pr.accepts[0].maxAmountRequired === '50000', 'amount = 50000 atomic ($0.05 @ 6dec)');
ok(typeof pr.accepts[0].asset === 'string' && pr.accepts[0].asset.startsWith('0x'), 'asset = USDC contract');

// --- header encode/decode ---
const enc = encodeHeader({ tx_hash: '0xabc', from: '0xdef' });
ok(decodeHeader(enc).tx_hash === '0xabc', 'encode/decode roundtrip');
ok(decodeHeader('@@not-valid@@') === null, 'bad header decodes to null');

// --- payment proof extraction (header v1/v2 + body fallbacks) ---
ok(extractPaymentProof({ headers: { 'x-payment': enc }, body: {} }).tx_hash === '0xabc', 'proof from X-PAYMENT header');
ok(extractPaymentProof({ headers: { 'payment-signature': enc }, body: {} }).tx_hash === '0xabc', 'proof from PAYMENT-SIGNATURE header');
ok(extractPaymentProof({ headers: {}, body: { payment: { tx_hash: '0x9' } } }).tx_hash === '0x9', 'proof from body.payment');
ok(extractPaymentProof({ headers: {}, body: { tx_hash: '0x7' } }).tx_hash === '0x7', 'proof from body.tx_hash');
ok(extractPaymentProof({ headers: {}, body: {} }) === null, 'no proof → null');

// --- Phase 2: facilitator ---
ok(facilitatorEnabled({}) === false, 'no facilitator by default');
ok(facilitatorEnabled({ AXP_X402_FACILITATOR_URL: 'https://x402.org/facilitator' }) === true, 'facilitator enabled via env');
ok(isSignedPayload({ scheme: 'exact', payload: { signature: '0x', authorization: {} } }) === true, 'signed payload detected');
ok(isSignedPayload({ tx_hash: '0x1' }) === false, 'bare tx_hash is not a signed payload');
ok(isSignedPayload(null) === false, 'null is not a signed payload');

const facEnv = { AXP_X402_FACILITATOR_URL: 'https://fac.example' };
const okFetch = async (url) => ({
  ok: true, status: 200,
  json: async () => (String(url).endsWith('/verify')
    ? { isValid: true, payer: '0xpayer' }
    : { success: true, transaction: '0xsettled', payer: '0xpayer' }),
});
const vr = await verifyViaFacilitator({ paymentPayload: {}, paymentRequirements: {}, env: facEnv, fetchImpl: okFetch });
ok(vr.ok && vr.payer === '0xpayer', 'facilitator /verify ok → payer returned');
const sr = await settleViaFacilitator({ paymentPayload: {}, paymentRequirements: {}, env: facEnv, fetchImpl: okFetch });
ok(sr.ok && sr.transaction === '0xsettled', 'facilitator /settle ok → tx returned');

const invalidFetch = async () => ({ ok: true, status: 200, json: async () => ({ isValid: false, invalidReason: 'insufficient_funds' }) });
const vbad = await verifyViaFacilitator({ paymentPayload: {}, paymentRequirements: {}, env: facEnv, fetchImpl: invalidFetch });
ok(!vbad.ok && vbad.invalidReason === 'insufficient_funds', 'facilitator /verify invalid → reason surfaced');

const noFac = await verifyViaFacilitator({ paymentPayload: {}, paymentRequirements: {}, env: {}, fetchImpl: okFetch });
ok(!noFac.ok, 'verify without facilitator url → not ok');

console.log(`x402.test.mjs: ${passed} checks passed`);
