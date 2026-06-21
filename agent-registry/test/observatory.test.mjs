import assert from 'node:assert';
import { buildObservatory } from '../src/observatory.js';

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed += 1; };

const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();
const DAY = 24 * 60 * 60 * 1000;

const agents = [
  { id: 'a1', status: 'active', services: ['security_audit'] },
  { id: 'a2', status: 'active', services: ['content', 'security_audit'] },
  { id: 'a3', status: 'active', services: ['content'] },
  { id: 'a4', status: 'active', services: ['content'] },
  { id: 'a5', status: 'suspended', services: ['lead_gen'] }, // inactive → ignored
];

const intents = [
  // lead_gen: lots of well-paid demand, ZERO active agents → should rank top
  { intent_id: 'i1', service: 'lead_gen', status: 'open', reward_usd: 800, created_at: iso(1 * DAY), skills: ['outreach'] },
  { intent_id: 'i2', service: 'lead_gen', status: 'open', reward_usd: 600, created_at: iso(2 * DAY), skills: ['outreach'] },
  // security_audit: growing (2 recent vs 1 prior), decent pay, 2 agents
  { intent_id: 'i3', service: 'security_audit', status: 'open', reward_usd: 500, created_at: iso(1 * DAY) },
  { intent_id: 'i4', service: 'security_audit', status: 'open', reward_usd: 300, created_at: iso(3 * DAY) },
  { intent_id: 'i5', service: 'security_audit', status: 'settled', reward_usd: 0, created_at: iso(10 * DAY) },
  // content: well supplied (3 agents), low pay
  { intent_id: 'i6', service: 'content', status: 'open', reward_usd: 50, created_at: iso(2 * DAY) },
];

const contracts = [
  { status: 'settled', quote: { service: 'security_audit', requested_capacity: 500 } },
  { status: 'prepared', quote: { service: 'content', requested_capacity: 50 } }, // not settled → ignored
];

const obs = buildObservatory({ agents, intents, contracts });

ok(obs.schema === 'axp.economic_observatory.v0', 'schema tag');
ok(obs.totals.active_agents === 4, 'counts only active agents');
ok(obs.totals.open_intents === 5, 'counts open intents');

const byCat = Object.fromEntries(obs.categories.map((c) => [c.category, c]));
ok(byCat.lead_gen.active_agents === 0, 'lead_gen has no active supply');
ok(byCat.lead_gen.underserved === true, 'lead_gen flagged underserved');
ok(byCat.content.underserved === false, 'content not underserved (3 agents >= 1 open)');

// lead_gen (high pay, zero supply) must out-rank content (low pay, high supply)
ok(obs.categories[0].category === 'lead_gen', 'highest opportunity = underserved high-paying niche');
ok(byCat.lead_gen.opportunity_score > byCat.content.opportunity_score, 'opportunity score ranks demand/supply correctly');

// settled volume only from settled contracts
ok(byCat.security_audit.settled_volume_usd === 500, 'settled volume from settled contract');
ok(byCat.security_audit.settled_contracts === 1, 'one settled contract');

// highest revenue opportunity is the $800 lead_gen intent
ok(obs.highest_revenue_opportunities[0].reward_usd === 800, 'top revenue opportunity sorted by reward');
ok(obs.highest_revenue_opportunities[0].service === 'lead_gen', 'top opportunity is lead_gen');

// skills aggregation
const skills = Object.fromEntries(obs.top_skills_in_demand.map((s) => [s.skill, s.requests]));
ok(skills.lead_gen === 2, 'service counted as a skill demand signal');
ok(skills.outreach === 2, 'explicit skill counted');

// empty input is safe
const empty = buildObservatory({});
ok(empty.categories.length === 0 && empty.totals.open_intents === 0, 'empty input safe');

console.log(`observatory.test.mjs: ${passed} checks passed`);
