import assert from 'node:assert';
import { aggregateExternalSignals } from '../src/external-signals.js';
import { buildObservatory } from '../src/observatory.js';
import { planObservatoryOpportunities } from '../src/observatory-publisher.js';

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed += 1; };
const approx = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

const now = Date.now();
const iso = (msAgo = 0) => new Date(now - msAgo).toISOString();
const DAY = 86_400_000;

// --- aggregateExternalSignals -------------------------------------------------

// Dedup per (source, category, metric): newest wins, older is discarded.
const dedup = aggregateExternalSignals([
  { source: 'github', category: 'sec', metric: 'repositories', value: 50, observed_at: iso(30 * DAY) },
  { source: 'github', category: 'sec', metric: 'repositories', value: 200, observed_at: iso(0) },
], now);
ok(approx(dedup.get('sec').external_demand_index, Math.log10(201)), 'dedup keeps newest signal (value 200)');
ok(dedup.get('sec').external_sources.join(',') === 'github', 'single source tracked');

// Multiple sources stack and mcp_registry is weighted higher than github.
const multi = aggregateExternalSignals([
  { source: 'github', category: 'sec', value: 200, observed_at: iso(0) },
  { source: 'mcp_registry', category: 'sec', value: 50, observed_at: iso(0) },
], now);
ok(multi.get('sec').external_sources.length === 2, 'two sources aggregated');
ok(multi.get('sec').external_demand_index > dedup.get('sec').external_demand_index, 'extra source raises index');

// Recency: a 28-day-old signal (2 half-lives) is worth ~1/4 of a fresh one.
const fresh = aggregateExternalSignals([{ source: 'github', category: 'x', value: 100, observed_at: iso(0) }], now);
const stale = aggregateExternalSignals([{ source: 'github', category: 'x', value: 100, observed_at: iso(28 * DAY) }], now);
ok(stale.get('x').external_demand_index < fresh.get('x').external_demand_index * 0.3, 'older signals decay');

// growth_pct carried through.
const grow = aggregateExternalSignals([{ source: 'github', category: 'y', value: 100, growth_pct: 280, observed_at: iso(0) }], now);
ok(grow.get('y').external_growth_pct === 280, 'growth_pct preserved');

// Invalid signals are dropped.
const bad = aggregateExternalSignals([{ source: 'github' }, { category: 'z' }, null], now);
ok(bad.size === 0, 'invalid signals ignored');

// --- buildObservatory with external signals -----------------------------------

// External-only category: demand exists outside, zero AXP supply → top opportunity.
const extOnly = buildObservatory({
  agents: [], intents: [], contracts: [],
  externalSignals: [{ source: 'github', category: 'ai_sdr', value: 1842, growth_pct: 280, observed_at: iso(0) }],
});
const aiSdr = extOnly.categories.find((c) => c.category === 'ai_sdr');
ok(aiSdr && aiSdr.external_only === true, 'external-only category surfaced');
ok(aiSdr.underserved === true, 'external-only category flagged underserved');
ok(aiSdr.opportunity_score > 0, 'external-only category has opportunity score');
ok(extOnly.totals.external_only_categories === 1, 'totals count external-only categories');

// External demand boosts the score of an existing category.
const baseIntent = { intent_id: 'i1', service: 'research', status: 'open', reward_usd: 100, created_at: iso(DAY) };
const noExt = buildObservatory({ agents: [], intents: [baseIntent], contracts: [] });
const withExt = buildObservatory({
  agents: [], intents: [baseIntent], contracts: [],
  externalSignals: [{ source: 'github', category: 'research', value: 5000, growth_pct: 100, observed_at: iso(0) }],
});
const rNo = noExt.categories.find((c) => c.category === 'research').opportunity_score;
const rYes = withExt.categories.find((c) => c.category === 'research').opportunity_score;
ok(rYes > rNo, 'external demand raises an existing category opportunity score');

// --- planObservatoryOpportunities ---------------------------------------------

const obs = buildObservatory({
  agents: [],
  intents: [
    { intent_id: 'l1', service: 'lead_gen', status: 'open', reward_usd: 800, created_at: iso(DAY) },
    { intent_id: 'c1', service: 'content', status: 'open', reward_usd: 50, created_at: iso(DAY) },
  ],
  contracts: [],
});

const plan = planObservatoryOpportunities({ observatory: obs, existingIntents: [], max: 2 });
ok(plan.length === 2, 'plans both underserved categories');
ok(plan[0].service === 'lead_gen', 'highest-opportunity category first');
ok(plan[0].source === 'axp_observatory' && plan[0].requester === 'axp_protocol', 'tagged as protocol-published opportunity');
ok(plan[0].reward_usd === 800, 'reward derived from avg open reward');
ok(plan[0].urgency === 'HIGH', 'very high score => HIGH urgency');

// Idempotency: skip a category that already has a live observatory opportunity.
const planSkip = planObservatoryOpportunities({
  observatory: obs,
  existingIntents: [{ status: 'open', source: 'axp_observatory', service: 'lead_gen' }],
  max: 2,
});
ok(!planSkip.some((p) => p.service === 'lead_gen'), 'does not duplicate a live opportunity');

// minScore gate.
const planHigh = planObservatoryOpportunities({ observatory: obs, existingIntents: [], minScore: 1000, max: 5 });
ok(planHigh.every((p) => p.service !== 'content'), 'low-score categories filtered by minScore');

// max cap.
const planCap = planObservatoryOpportunities({ observatory: obs, existingIntents: [], max: 1 });
ok(planCap.length === 1, 'respects max cap');

// --- opportunity gap + launchable templates ---
const gapObs = buildObservatory({
  agents: [{ id: 'a1', status: 'active', services: ['code_review'] }],
  intents: [],
  contracts: [],
  externalSignals: [{ source: 'github', category: 'code_review', value: 3000, growth_pct: 120, observed_at: iso(0) }],
});
const cr = gapObs.categories.find((c) => c.category === 'code_review');
ok(cr.launchable === true && cr.template_id === 'code_review', 'code_review maps to a launchable template');
ok(cr.external_demand_units === 3000, 'demand units = raw external value (3000)');
ok(cr.opportunity_gap === 2999, 'gap = demand(3000) + open(0) - supply(1) = 2999');
ok(gapObs.launch_opportunities.some((o) => o.template_id === 'code_review' && o.opportunity_gap === 2999), 'launch_opportunities surfaces the gap with a template');

const sec = buildObservatory({ externalSignals: [{ source: 'github', category: 'security_audit', value: 100, observed_at: iso(0) }] })
  .categories.find((c) => c.category === 'security_audit');
ok(sec.launchable === false && sec.template_id === null, 'category without a template is not launchable');

console.log(`observatory-signals.test.mjs: ${passed} checks passed`);
