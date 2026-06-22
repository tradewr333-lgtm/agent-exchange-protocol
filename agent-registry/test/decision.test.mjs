import assert from 'node:assert';
import { computeDecision, teaser, normalizeSymbol, decisionPriceUsd, minerRewardShare } from '../src/decision.js';

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed += 1; };

const now = 1_700_000_000_000;
const fresh = (over = {}) => ({ ts: now - 1000, ...over });

// --- symbol normalization ---
ok(normalizeSymbol('BTC/USDT') === 'BTC/USD', 'USDT quote → USD');
ok(normalizeSymbol('btc-usdc') === 'BTC/USD', 'dash + USDC → BTC/USD');
ok(normalizeSymbol('ETH/EUR') === 'ETH/EUR', 'non-stable quote preserved');

// --- config ---
ok(decisionPriceUsd({}) === 0.01, 'default decision price $0.01');
ok(decisionPriceUsd({ AXP_DECISION_PRICE_USD: '0.5' }) === 0.5, 'price from env');
ok(minerRewardShare({}) === 0.2, 'default reward share 20%');
ok(minerRewardShare({ AXP_DECISION_MINER_SHARE: '0.35' }) === 0.35, 'share from env');

// --- no data ---
const empty = computeDecision({ symbol: 'BTC/USD', observations: [], now });
ok(empty.decision.action === 'HOLD' && empty.opportunity === null, 'no obs → HOLD, no opportunity');
ok(empty.context.sources_count === 0, 'no sources counted');

// --- single source → no arbitrage, consensus only ---
const one = computeDecision({ symbol: 'BTC/USD', now, observations: [fresh({ symbol: 'BTC/USDT', source: 'binance', price: 65000, agent_id: 'a1', owner: '0xowner' })] });
ok(one.decision.action === 'HOLD', 'single source → HOLD');
ok(one.context.consensus_price === 65000, 'consensus price from single source');
ok(one.contributors.length === 1 && one.contributors[0].agent_id === 'a1', 'single contributor recorded');

// --- real arbitrage opportunity across venues ---
const arb = computeDecision({
  symbol: 'BTC/USD', now,
  env: { AXP_DECISION_FEE_PCT_PER_SIDE: '0.1', AXP_DECISION_MIN_PROFIT_PCT: '0.2' },
  observations: [
    fresh({ symbol: 'BTC/USD', source: 'binance', bid: 64900, ask: 64950, agent_id: 'm1', owner: '0xA' }),
    fresh({ symbol: 'BTC/USDT', source: 'kraken', bid: 65600, ask: 65650, agent_id: 'm2', owner: '0xB' }),
    fresh({ symbol: 'BTC/USDC', source: 'coinbase', bid: 65100, ask: 65150, agent_id: 'm3', owner: '0xC' }),
  ],
});
ok(arb.decision.action === 'BUY_NOW', 'profitable spread → BUY_NOW');
ok(arb.opportunity.buy_from.source === 'binance', 'buy from cheapest ask (binance)');
ok(arb.opportunity.sell_to.source === 'kraken', 'sell to richest bid (kraken)');
ok(arb.opportunity.net_profit_percent > 0.2, 'net profit above threshold');
// gross = (65600-64950)/64950*100 ≈ 1.0008%; net = gross - 0.2 ≈ 0.80%
ok(Math.abs(arb.opportunity.gross_profit_percent - 1.0008) < 0.01, 'gross spread computed correctly');
ok(arb.decision.confidence > 0 && arb.decision.confidence <= 1, 'confidence in (0,1]');
ok(arb.contributors.length === 2, 'BUY_NOW credits the two endpoint miners');

// --- spread below threshold → HOLD ---
const tiny = computeDecision({
  symbol: 'BTC/USD', now,
  env: { AXP_DECISION_FEE_PCT_PER_SIDE: '0.1', AXP_DECISION_MIN_PROFIT_PCT: '0.5' },
  observations: [
    fresh({ symbol: 'BTC/USD', source: 'binance', bid: 64990, ask: 65000, agent_id: 'm1' }),
    fresh({ symbol: 'BTC/USD', source: 'kraken', bid: 65040, ask: 65050, agent_id: 'm2' }),
  ],
});
ok(tiny.decision.action === 'HOLD', 'sub-threshold spread → HOLD');

// --- stale data ignored ---
const stale = computeDecision({
  symbol: 'BTC/USD', now,
  observations: [
    { symbol: 'BTC/USD', source: 'binance', price: 64000, ts: now - 10 * 60 * 1000, agent_id: 'm1' },
    fresh({ symbol: 'BTC/USD', source: 'kraken', price: 66000, agent_id: 'm2' }),
  ],
});
ok(stale.context.sources_count === 1, 'stale observation filtered out (only fresh kraken left)');

// --- plausibility penalty: absurd 10% spread → low confidence ---
const absurd = computeDecision({
  symbol: 'BTC/USD', now,
  observations: [
    fresh({ symbol: 'BTC/USD', source: 'a', bid: 60000, ask: 60010, agent_id: 'm1' }),
    fresh({ symbol: 'BTC/USD', source: 'b', bid: 66000, ask: 66010, agent_id: 'm2' }),
  ],
});
ok(absurd.opportunity.net_profit_percent > 5, 'absurd spread detected');
ok(absurd.decision.confidence < 0.5, 'implausibly large spread → penalized confidence');

// --- teaser hides executable detail ---
const t = teaser(arb);
ok(t.decision.action === 'BUY_NOW' && t.opportunity === undefined, 'teaser omits opportunity');
ok(typeof t.decision.confidence === 'number', 'teaser keeps confidence');
ok(t.paid_endpoint === 'POST /x402/decision/call', 'teaser points to paid endpoint');

console.log(`decision.test.mjs: ${passed} checks passed`);
