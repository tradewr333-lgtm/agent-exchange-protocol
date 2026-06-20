// Tests for the Matchmaker: pure planning + execution (intro + scion sponsorship).
// Run with: AXP_DATA_DIR=<tmp> node agent-registry/test/matchmaker.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.AXP_DATA_DIR;
assert.ok(dataDir, 'AXP_DATA_DIR must be set');
assert.ok(!process.env.DATABASE_URL, 'DATABASE_URL must be unset (JSON mode)');

mkdirSync(dataDir, { recursive: true });
writeFileSync(
  join(dataDir, 'agents.json'),
  readFileSync(join(here, '..', 'data', 'agents.json'), 'utf8').replace(/^﻿/, ''),
);

const { planMatchmaking } = await import('../../examples/axp-matchmaker/plan.js');
const { runMatchmaker } = await import('../../examples/axp-matchmaker/matchmaker.js');
const { publishIntent } = await import('../src/intents.js');
const { getOpportunityGraph } = await import('../src/opportunities.js');
const { postInboxMessage, getInbox } = await import('../src/inbox.js');
const { sponsorScion, getLineage } = await import('../src/growth.js');

let passed = 0;
function check(label, condition) {
  assert.ok(condition, label);
  passed += 1;
  console.log(`  PASS ${label}`);
}

console.log('AXP Matchmaker — test\n');

// --- Pure planning --------------------------------------------------------
const fakeGraph = {
  suggested_matches: [
    { intent_id: 'i1', service: 'research', reward_usd: 1000, best_agent: { agent_id: 'a1', match_score: 80 } },
  ],
  spawn_opportunities: [
    { intent_id: 'i2', service: 'security_audit', reward_usd: 5000, required_capacity_usd: 2500 },
  ],
  idle_agents: [
    { agent_id: 'a1', trust_score: 100, available_capacity_usd: 5000 },
    { agent_id: 'a2', trust_score: 10, available_capacity_usd: 1000 },
  ],
};
const plan = planMatchmaking(fakeGraph);
check('plans 1 introduction', plan.introductions.length === 1 && plan.introductions[0].agent_id === 'a1');
check('plans 1 sponsorship', plan.sponsorships.length === 1 && plan.sponsorships[0].service === 'security_audit');
check('sponsor is highest-trust idle agent', plan.sponsor_agent_id === 'a1');
check('committed capacity >= intent requirement', plan.sponsorships[0].committed_capacity_usd === 2500);

const explicitPlan = planMatchmaking(fakeGraph, { sponsorAgentId: 'agent_0002' });
check('explicit sponsor override respected', explicitPlan.sponsor_agent_id === 'agent_0002');

// --- End-to-end execution (JSON mode, in-process client) ------------------
await publishIntent({ title: 'Research agent market', service: 'research', reward_usd: 1000, required_capacity_usd: 500 });
await publishIntent({ title: 'Audit Solana program', service: 'security_audit', skills: ['solidity', 'audit'], reward_usd: 5000, required_capacity_usd: 2000 });

const client = {
  getOpportunityGraph: (f) => getOpportunityGraph(f),
  postInboxMessage: async (id, input) => {
    const r = await postInboxMessage(id, input);
    if (!r.ok) throw new Error(JSON.stringify(r));
    return r.message;
  },
  sponsorScion: async (input) => {
    const r = await sponsorScion(input);
    if (!r.ok) throw new Error(JSON.stringify(r));
    return r;
  },
};

const lineageBefore = (await getLineage()).nodes.length;
const run = await runMatchmaker({ client, execute: true });
check('matchmaker ran in execute mode', run.mode === 'execute');
check('made at least 1 introduction', run.executed.introductions.length >= 1);
check('sponsored at least 1 scion', run.executed.sponsorships.some((s) => s.scion_id));

const lineageAfter = (await getLineage()).nodes.length;
check('lineage grew (scion minted)', lineageAfter > lineageBefore);

// The best-fit agent for the research intent received an inbox introduction.
const introTarget = run.executed.introductions[0].agent_id;
const inbox = await getInbox(introTarget, { limit: 50 });
check('introduced agent has an opportunity_intro message',
  inbox.messages.some((m) => m.kind === 'opportunity_intro'));

// After sponsoring, the security_audit intent is no longer a spawn opportunity.
const graphAfter = await getOpportunityGraph({ limit: 50 });
check('security_audit now matched (spawn closed)',
  !graphAfter.spawn_opportunities.some((s) => s.service === 'security_audit')
  && graphAfter.suggested_matches.some((m) => m.service === 'security_audit'));

console.log(`\nAll ${passed} checks passed.`);
