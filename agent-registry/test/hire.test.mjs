import assert from 'node:assert';
import { computeSplit, buildHireQuote, hireAmounts, hireFeeRate, hirePaymentEnabled, HIRE_FEE_RATE } from '../src/hire.js';
import { payoutEnabled } from '../src/payout.js';

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed += 1; };

// computeSplit: AXP fee + owner share.
const s = computeSplit(10, 0.2);
ok(s.fee === 2 && s.owner === 8, '20% of 10 => fee 2 / owner 8');
ok(computeSplit(0).fee === 0 && computeSplit(-3).owner === 0, 'non-positive => zero split');
const s2 = computeSplit(0.005, 0.2);
ok(Math.abs(s2.fee - 0.001) < 1e-9 && Math.abs(s2.owner - 0.004) < 1e-9, 'works with crypto-sized amounts');
ok(computeSplit(10).owner === 8, 'default fee rate is 20%');

// fee rate env override + bounds.
ok(hireFeeRate({}) === HIRE_FEE_RATE, 'default fee rate');
ok(hireFeeRate({ AXP_HIRE_FEE_RATE: '0.1' }) === 0.1, 'fee rate from env');
ok(hireFeeRate({ AXP_HIRE_FEE_RATE: '5' }) === HIRE_FEE_RATE, 'out-of-range fee rate ignored');

// amounts + quote.
const a = hireAmounts({ AXP_HIRE_PRICE_BNB: '0.01' });
ok(a.USDT === 3 && a.BNB === 0.01, 'amounts (default USDT 3, BNB from env)');
const q = buildHireQuote({ AXP_TREASURY_ADDRESS: '0xabc0000000000000000000000000000000000001' });
ok(q.enabled === true && q.options.length === 3, 'quote enabled with 3 options when treasury set');
ok(q.options.find((o) => o.asset === 'USDT').token_address.startsWith('0x55d3983'), 'BSC USDT token address');
ok(buildHireQuote({}).enabled === false, 'quote disabled without treasury');
ok(hirePaymentEnabled({ AXP_TREASURY_ADDRESS: '0xabc' }) === true && hirePaymentEnabled({}) === false, 'hire gate');

// payout gating (no key => not enabled, no network call).
ok(payoutEnabled({}) === false && payoutEnabled({ AXP_PAYOUT_PRIVATE_KEY: '0xkey' }) === true, 'payout gate by env');

console.log(`hire.test.mjs: ${passed} checks passed`);
