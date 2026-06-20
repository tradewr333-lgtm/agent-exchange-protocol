// Integration test for the AXP Agent Economy Layer (JSON storage mode).
// Run with: AXP_DATA_DIR=<tmp> node agent-registry/test/economy-layer.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.AXP_DATA_DIR;
assert.ok(dataDir, 'AXP_DATA_DIR must be set for the isolated test');
assert.ok(!process.env.DATABASE_URL, 'DATABASE_URL must be unset (JSON mode)');

// Seed the isolated data dir with the demo agents before importing modules use it.
mkdirSync(dataDir, { recursive: true });
const seedAgents = readFileSync(join(here, '..', 'data', 'agents.json'), 'utf8').replace(/^﻿/, '');
writeFileSync(join(dataDir, 'agents.json'), seedAgents);

const { publishIntent, getIntentFeed, claimIntent, getIntent } = await import('../src/intents.js');
const { getOpportunitiesForAgent, getOpportunityGraph } = await import('../src/opportunities.js');
const { sponsorScion, distributeDiscoveryRewards, getGrowthMetrics, getLineage } = await import('../src/growth.js');
const { getInbox, postInboxMessage } = await import('../src/inbox.js');

let passed = 0;
function check(label, condition) {
  assert.ok(condition, label);
  passed += 1;
  console.log(`  PASS ${label}`);
}

console.log('AXP Agent Economy Layer — integration test\n');

// 1) Intent Feed -----------------------------------------------------------
const research = await publishIntent({
  title: 'Research AI agent frameworks',
  service: 'research',
  reward_usd: 1200,
  urgency: 'HIGH',
  required_capacity_usd: 500,
});
check('publishIntent returns 201', research.status === 201 && research.ok);

// No active agent has the solana_audit specialty => initially a spawn opportunity,
// but realistic thresholds so a sponsored specialist scion can later fill it.
const unfillable = await publishIntent({
  title: 'Audit Solana program',
  service: 'solana_audit',
  reward_usd: 5000,
  urgency: 'CRITICAL',
  required_capacity_usd: 1000,
  min_trust_score: 0,
});
check('publish specialist-gap intent', unfillable.ok);

const feed = await getIntentFeed({ limit: 10 });
check('feed lists open intents', feed.count >= 2);
check('feed sorted by priority (critical first)', feed.intents[0].urgency === 'CRITICAL');

// 2) Opportunity Router ----------------------------------------------------
const opps = await getOpportunitiesForAgent('agent_0002');
check('opportunities for agent_0002 found', opps.ok && opps.count >= 1);
check('research intent is eligible for agent_0002',
  opps.opportunities.some((o) => o.intent_id === research.intent.intent_id && o.eligible));
check('unfillable intent NOT eligible for agent_0002',
  !opps.opportunities.some((o) => o.intent_id === unfillable.intent.intent_id));

const graph = await getOpportunityGraph({ limit: 10 });
check('opportunity graph surfaces spawn opportunities',
  graph.stats.spawn_opportunities >= 1
  && graph.spawn_opportunities.some((s) => s.intent_id === unfillable.intent.intent_id));
check('opportunity graph reports idle agents', graph.stats.idle_agents >= 1);

// 3) Claim -----------------------------------------------------------------
const claim = await claimIntent(research.intent.intent_id, { agent_id: 'agent_0002' });
check('claimIntent succeeds', claim.ok && claim.intent.status === 'claimed');
const reread = await getIntent(research.intent.intent_id);
check('claimed intent persists', reread.claimed_by === 'agent_0002');

// 4) Genesis Cascade: spawn a 2-level lineage ------------------------------
const scion1 = await sponsorScion({
  sponsor_agent_id: 'agent_0002',
  service: 'solana_audit',
  committed_capacity_usd: 3000,
  intent_id: unfillable.intent.intent_id,
});
check('sponsorScion creates scion1', scion1.ok && scion1.scion.agent_id.startsWith('scion_'));

const scion2 = await sponsorScion({
  sponsor_agent_id: scion1.scion.agent_id,
  service: 'solana_audit',
  committed_capacity_usd: 1500,
});
check('sponsorScion creates scion2 under scion1', scion2.ok);

const lineage = await getLineage();
check('lineage has 3 nodes (root + 2 scions)', lineage.nodes.length === 3);
check('lineage edges link sponsor->scion', lineage.edges.length === 2);

// scion1 now an active specialist => unfillable intent becomes matchable
const graph2 = await getOpportunityGraph({ limit: 10 });
check('after spawn, solana intent is now matched (not a spawn op)',
  graph2.suggested_matches.some((m) => m.intent_id === unfillable.intent.intent_id));

// 5) Discovery override on settlement --------------------------------------
const dist = await distributeDiscoveryRewards({
  provider_agent_id: scion2.scion.agent_id,
  value_usd: 1000,
  contract_id: 'contract_test_1',
});
check('distribution reaches 2 ancestors', dist.distributed.length === 2);
const l1 = dist.distributed.find((d) => d.level === 1);
const l2 = dist.distributed.find((d) => d.level === 2);
check('L1 override = 10% to scion1', l1.beneficiary_agent_id === scion1.scion.agent_id && Math.abs(l1.amount_axp - 100) < 1e-6);
check('L2 override = 5% to agent_0002', l2.beneficiary_agent_id === 'agent_0002' && Math.abs(l2.amount_axp - 50) < 1e-6);

// 6) Universal Inbox -------------------------------------------------------
// Publish a fresh open intent agent_0002 can serve (the first was claimed above).
await publishIntent({
  title: 'Summarize market reports',
  service: 'research',
  reward_usd: 800,
  urgency: 'MEDIUM',
  required_capacity_usd: 300,
});
const inbox = await getInbox('agent_0002', { limit: 50 });
check('inbox loads for agent_0002', inbox.ok);
check('inbox shows discovery earnings', inbox.summary.discovery_earnings_axp >= 50);
check('inbox feed contains a discovery_reward', inbox.feed.some((f) => f.type === 'discovery_reward'));
check('inbox surfaces opportunities', inbox.opportunities.length >= 1);

const msg = await postInboxMessage('agent_0002', { subject: 'hello', body: 'gm', from_id: 'axp://agent_0001' });
check('postInboxMessage stores a message', msg.ok && msg.message.id > 0);

// 7) Growth metrics / K-factor --------------------------------------------
const metrics = await getGrowthMetrics({ autotune: true });
check('metrics report 2 scions', metrics.population.scions === 2);
check('metrics report 2 sponsors', metrics.population.sponsors === 2);
check('k_factor computed', typeof metrics.k_factor === 'number');
check('treasury accounted', metrics.treasury.spent_axp >= 150);
check('sub-critical K raises incentive multiplier', metrics.incentive.reward_multiplier > 1);

console.log(`\nAll ${passed} checks passed.`);
