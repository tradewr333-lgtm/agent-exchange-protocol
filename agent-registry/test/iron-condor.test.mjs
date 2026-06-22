import assert from 'node:assert';
import { buildIronCondor } from '../src/iron-condor.js';

let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed += 1; };

const spot = 100000;
const chain = [
  // puts (strikes below spot)
  { type: 'P', strike: 95000, delta: -0.22, bid: 0.02, ask: 0.021 },
  { type: 'P', strike: 90000, delta: -0.12, bid: 0.010, ask: 0.011 }, // short put (≈ -0.12)
  { type: 'P', strike: 85000, delta: -0.06, bid: 0.004, ask: 0.005 }, // long put wing
  { type: 'P', strike: 80000, delta: -0.03, bid: 0.002, ask: 0.003 },
  // calls (strikes above spot)
  { type: 'C', strike: 105000, delta: 0.22, bid: 0.02, ask: 0.021 },
  { type: 'C', strike: 110000, delta: 0.12, bid: 0.010, ask: 0.011 }, // short call (≈ +0.12)
  { type: 'C', strike: 115000, delta: 0.06, bid: 0.004, ask: 0.005 }, // long call wing
  { type: 'C', strike: 120000, delta: 0.03, bid: 0.002, ask: 0.003 },
];

const r = buildIronCondor(chain, { spot, putDelta: -0.12, callDelta: 0.12, wingStrikes: 1, asset: 'BTC', expiry: '28JUN26' });
ok(r.ok, 'builds');
ok(r.legs.length === 4, 'four legs');
ok(r.legs[0].strike === 90000 && r.legs[0].action === 'SELL' && r.legs[0].type === 'P', 'short put = 90000 (delta -0.12)');
ok(r.legs[1].strike === 85000 && r.legs[1].action === 'BUY', 'long put wing = 85000');
ok(r.legs[2].strike === 110000 && r.legs[2].action === 'SELL' && r.legs[2].type === 'C', 'short call = 110000 (delta +0.12)');
ok(r.legs[3].strike === 115000 && r.legs[3].action === 'BUY', 'long call wing = 115000');
// credit BTC = (0.010+0.010) - (0.005+0.005) = 0.010 ; * 100000 = 1000 USD
ok(r.credit_usd === 1000, 'net credit $1000');
// max loss = max(5000,5000) - 1000 = 4000
ok(r.max_loss_usd === 4000, 'max loss $4000');
ok(r.breakevens.lower === 89000 && r.breakevens.upper === 111000, 'breakevens 89k / 111k');
ok(Math.abs(r.approx_prob_in_range - 0.76) < 1e-9, 'approx prob ≈ 0.76 (1 - 0.12 - 0.12)');
ok(r.decision.action === 'OPEN', 'positive credit + defined risk → OPEN');
ok(typeof r.disclaimer === 'string' && /NOT investment advice/.test(r.disclaimer), 'has not-advice disclaimer');

// insufficient chain → graceful
ok(buildIronCondor([{ type: 'P', strike: 90000, delta: -0.12, bid: 0.01 }], { spot }).ok === false, 'insufficient chain → ok:false');
ok(buildIronCondor(chain, {}).ok === false, 'missing spot → ok:false');

console.log(`iron-condor.test.mjs: ${passed} checks passed`);
