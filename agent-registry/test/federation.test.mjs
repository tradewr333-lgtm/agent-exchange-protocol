// Tests for the Federation bridge: pure planning + import execution.
// Run with: AXP_DATA_DIR=<tmp> node agent-registry/test/federation.test.mjs
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

const { planFederation } = await import('../../examples/axp-federation/plan.js');
const { listEcosystemAgents, SUPPORTED_ECOSYSTEMS } = await import('../../examples/axp-federation/adapters.js');
const { runFederation } = await import('../../examples/axp-federation/federation.js');
const { sponsorScion, getLineage } = await import('../src/growth.js');
const { listAgents } = await import('../src/registry.js');
const { publishIntent } = await import('../src/intents.js');
const { getOpportunityGraph } = await import('../src/opportunities.js');

let passed = 0;
function check(label, condition) {
  assert.ok(condition, label);
  passed += 1;
  console.log(`  PASS ${label}`);
}

console.log('AXP Federation — test\n');

// --- Adapters + pure planning ---------------------------------------------
check('adapters expose ecosystems', SUPPORTED_ECOSYSTEMS.includes('crewai') && SUPPORTED_ECOSYSTEMS.includes('mcp'));
check('listEcosystemAgents(all) merges rosters', listEcosystemAgents('all').length >= 5);

const external = [
  { ext_id: 'mcp:auditor-01', name: 'MCP Auditor', framework: 'mcp', services: ['security_audit'] },
  { ext_id: 'crewai:researcher-01', name: 'CrewAI Researcher', framework: 'crewai', services: ['research', 'analysis'] },
];
const plan = planFederation(external, { federationAgentId: 'agent_0002' });
check('plans an import per external agent', plan.count === 2);
check('primary service mapped, rest become skills',
  plan.imports[1].service === 'research' && plan.imports[1].skills.includes('analysis'));
check('ext_id embedded in federated name', plan.imports[0].name.includes('[mcp:auditor-01]'));

// --- Execution (in-process client) ----------------------------------------
const client = {
  findAgents: (f) => listAgents(f),
  sponsorScion: async (input) => {
    const r = await sponsorScion(input);
    if (!r.ok) throw new Error(JSON.stringify(r));
    return r;
  },
};

const agentsBefore = (await listAgents({})).count;
const run = await runFederation({ client, externalAgents: external, federationAgentId: 'agent_0002', execute: true });
check('imported 2 federated agents', run.executed.imported.filter((i) => i.axp_agent_id).length === 2);

const agentsAfter = (await listAgents({})).count;
check('registry grew by 2', agentsAfter === agentsBefore + 2);

const lineage = await getLineage();
check('lineage attributes federated agents to federation agent',
  lineage.edges.filter((e) => e.from === 'agent_0002').length >= 2);

// A federated MCP auditor (security_audit) can now be matched to a matching intent.
await publishIntent({ title: 'Audit a contract', service: 'security_audit', skills: ['audit'], reward_usd: 4000, required_capacity_usd: 500 });
const graph = await getOpportunityGraph({ limit: 50 });
check('federated security_audit agent matches the audit intent',
  graph.suggested_matches.some((m) => m.service === 'security_audit'));

// --- Dedupe: re-running skips already-federated ext_ids -------------------
const run2 = await runFederation({ client, externalAgents: external, federationAgentId: 'agent_0002', execute: true });
check('second run skips both as already federated',
  run2.executed.skipped.length === 2 && run2.executed.imported.length === 0);

console.log(`\nAll ${passed} checks passed.`);
