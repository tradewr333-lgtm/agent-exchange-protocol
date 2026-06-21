import assert from 'node:assert';
import {
  getPlanCatalog, planBySku, stripePlanBySku, stripePriceId,
  computeContractFee, netAfterFee, slotsForSku, CONTRACT_FEE_RATE,
} from '../src/billing.js';
import { buildLaunchQuote, launchPaymentEnabled } from '../src/payments-onchain.js';
import { listTemplates, templateById } from '../src/agent-templates.js';

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed += 1; };

// --- catalog ---
const cat = getPlanCatalog();
ok(cat.schema === 'axp.billing_catalog.v0', 'catalog schema');
ok(cat.launch.usd === 49, 'launch is $49');
ok(cat.hosting.length === 3, 'three hosting plans');
ok(cat.trust_api.usd_month === 99, 'trust api $99');
ok(cat.contract_fee_rate === 0.005, 'fee rate 0.5%');

ok(planBySku('hosting_starter').usd_month === 9, 'starter $9');
ok(planBySku('hosting_pro').usd_month === 29, 'pro $29');
ok(planBySku('hosting_scale').usd_month === 99 && slotsForSku('hosting_scale') === 100, 'scale $99 / 100 agents');
ok(planBySku('nope') === null, 'unknown sku null');

// --- stripe plan resolution ---
ok(stripePlanBySku('hosting_pro').sku === 'hosting_pro', 'pro is a stripe plan');
ok(stripePlanBySku('agent_launch') === null, 'launch is NOT a stripe plan (on-chain)');
ok(stripePriceId('hosting_starter', { STRIPE_PRICE_HOSTING_STARTER: 'price_123' }) === 'price_123', 'price id from env');
ok(stripePriceId('hosting_starter', {}) === null, 'no env => null price id');

// --- fee math ---
ok(computeContractFee(1000) === 5, '0.5% of 1000 = 5');
ok(computeContractFee(250) === 1.25, '0.5% of 250 = 1.25');
ok(computeContractFee(0) === 0 && computeContractFee(-5) === 0, 'non-positive => 0');
ok(netAfterFee(1000) === 995, 'net after fee');
ok(Math.abs(computeContractFee(123.45) - Number((123.45 * CONTRACT_FEE_RATE).toFixed(2))) < 1e-9, 'rounded to cents');

ok(slotsForSku('hosting_pro') === 5, 'pro grants 5 slots');
ok(slotsForSku('hosting_starter') === 1, 'starter grants 1 slot');

// --- launch quote (pure, no network) ---
const q = buildLaunchQuote({ AXP_TREASURY_ADDRESS: '0x1111111111111111111111111111111111111111', AXP_LAUNCH_PRICE_BNB: '0.08' });
ok(q.enabled === true, 'quote enabled when treasury set');
ok(q.chain_id === 56, 'BSC chain id');
ok(q.options.length === 3, 'three payment options');
ok(q.options.find((o) => o.asset === 'USDT').amount === 49, 'USDT amount 49');
ok(q.options.find((o) => o.asset === 'BNB').amount === 0.08, 'BNB amount from env');
ok(q.options.find((o) => o.asset === 'USDT').token_address.startsWith('0x55d3983'), 'BSC USDT address');
ok(buildLaunchQuote({}).enabled === false, 'quote disabled without treasury');
ok(launchPaymentEnabled({ AXP_TREASURY_ADDRESS: '0xabc' }) === true && launchPaymentEnabled({}) === false, 'launchPaymentEnabled gate');

// --- templates ---
ok(listTemplates().length === 10, 'ten templates');
ok(templateById('research').service === 'research', 'research template maps to research service');
ok(templateById('leadgen').service === 'lead_generation', 'leadgen maps to lead_generation');
ok(templateById('security_audit').service === 'security_audit', 'security_audit template present');
ok(templateById('market_research').service === 'trading', 'market_research maps to trading service');
ok(templateById('nope') === null, 'unknown template null');

console.log(`billing.test.mjs: ${passed} checks passed`);
