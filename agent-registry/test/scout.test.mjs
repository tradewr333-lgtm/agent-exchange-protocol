// Tests for the Scout (swarm): pure assessment + referral execution.
// Run with: AXP_DATA_DIR=<tmp> node agent-registry/test/scout.test.mjs
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

const { assessCandidate, planRecruitment, buildInvite } =
  await import('../../examples/axp-scout-swarm/assess.js');
const { runScout } = await import('../../examples/axp-scout-swarm/scout.js');
const { registerLineage, getLineage } = await import('../src/growth.js');

let passed = 0;
function check(label, condition) {
  assert.ok(condition, label);
  passed += 1;
  console.log(`  PASS ${label}`);
}

console.log('AXP Scout (swarm) — test\n');

// --- Pure assessment ------------------------------------------------------
check('no id + not on axp => invite',
  assessCandidate({ domain: 'x.com', agent_id: null, on_axp: false }).action === 'invite');
check('has id + not on axp => invite_and_refer',
  assessCandidate({ domain: 'y.com', agent_id: 'ext_1', on_axp: false }).action === 'invite_and_refer');
check('on axp => refer',
  assessCandidate({ domain: 'z.com', agent_id: 'ext_2', on_axp: true }).action === 'refer');
check('invite carries recruiter referral handle',
  buildInvite({ domain: 'x.com' }, { recruiterHandle: 'axp://agent_0002' }).referred_by === 'axp://agent_0002');

const plan = planRecruitment(
  [
    { domain: 'a.com', agent_id: 'ext_a', on_axp: false },
    { domain: 'b.com', agent_id: null, on_axp: false },
  ],
  { recruiterAgentId: 'agent_0002' },
);
check('plan refers only candidates with an agent_id', plan.referrals.length === 1 && plan.referrals[0].agent_id === 'ext_a');

// --- Execution with injected discovery (no network) -----------------------
const fakeDiscoveries = {
  'recruit-with-id.com': { domain: 'recruit-with-id.com', agent_id: 'ext_recruit_1', on_axp: false, services: ['research'] },
  'pure-external.com': { domain: 'pure-external.com', agent_id: null, on_axp: false, services: [] },
};
const client = {
  registerLineage: async (input) => {
    const r = await registerLineage(input);
    if (!r.ok) throw new Error(JSON.stringify(r));
    return r.lineage;
  },
};

const run = await runScout({
  client,
  candidates: Object.keys(fakeDiscoveries),
  discover: (target) => fakeDiscoveries[target],
  recruiterAgentId: 'agent_0002',
  execute: true,
});

check('scout executed', run.mode === 'execute');
check('one referral registered', run.executed.referrals.length === 1 && run.executed.referrals[0].agent_id === 'ext_recruit_1');
check('referral depth is 1 under recruiter', run.executed.referrals[0].depth === 1);
check('invite emitted for pure-external agent', run.invites.some((i) => i.to === 'pure-external.com'));

const lineage = await getLineage();
check('lineage edge recruiter -> recruit exists',
  lineage.edges.some((e) => e.from === 'agent_0002' && e.to === 'ext_recruit_1'));

console.log(`\nAll ${passed} checks passed.`);
