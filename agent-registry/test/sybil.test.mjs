// Tests for Sybil-resistant trust weighting + cascade counterparty-weighting.
// Run with: AXP_DATA_DIR=<tmp> node agent-registry/test/sybil.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dataDir = process.env.AXP_DATA_DIR;
assert.ok(dataDir, 'AXP_DATA_DIR must be set');
assert.ok(!process.env.DATABASE_URL, 'DATABASE_URL must be unset (JSON mode)');

const { reputationWeight, recencyDecay, computeWeightedScores } = await import('../src/sybil.js');

let passed = 0;
const check = (label, cond) => { assert.ok(cond, label); passed += 1; console.log(`  PASS ${label}`); };

console.log('AXP Sybil-resistance — test\n');

// --- reputationWeight ---
check('zero stake => weight 0', reputationWeight({ collateral_usd: 0 }) === 0);
check('anchor stake => ~0.63', Math.abs(reputationWeight({ collateral_usd: 1000 }) - 0.6321) < 0.01);
check('big stake => near 1', reputationWeight({ collateral_usd: 10000 }) > 0.99);
check('slashed => weight 0', reputationWeight({ collateral_usd: 99999, status: 'slashed' }) === 0);
check('fraud flag => weight 0', reputationWeight({ collateral_usd: 99999, trust_metrics: { fraud_flags: 1 } }) === 0);

// --- recencyDecay ---
check('now => ~1', Math.abs(recencyDecay(new Date().toISOString()) - 1) < 0.02);
check('60d ago, 30d half-life => ~0.25', Math.abs(recencyDecay(new Date(Date.now() - 60 * 86400000).toISOString(), 30) - 0.25) < 0.02);

// --- computeWeightedScores: Sybil ring earns ~0; stake-backed payer earns real ---
const now = new Date().toISOString();
const agents = [
  { agent_id: 'rich', collateral_usd: 5000, trust_metrics: {} },
  { agent_id: 'payer', collateral_usd: 5000, trust_metrics: {} },
  { agent_id: 'sybilA', collateral_usd: 0, trust_metrics: {} },
  { agent_id: 'sybilB', collateral_usd: 0, trust_metrics: {} },
];
const events = [
  // sybil ring: A and B (both zero-stake) "settle" huge volume with each other
  { event_type: 'contract_settled', agent_id: 'sybilA', counterparty_id: 'sybilB', value_usd: 1_000_000, created_at: now },
  { event_type: 'contract_settled', agent_id: 'sybilB', counterparty_id: 'sybilA', value_usd: 1_000_000, created_at: now },
  // genuine: rich gets paid by a stake-backed payer
  { event_type: 'contract_settled', agent_id: 'rich', counterparty_id: 'payer', value_usd: 1000, created_at: now },
];
const scores = computeWeightedScores(agents, events);
check('sybil ring earns ~0 weighted trust', scores.get('sybilA').sybil_resistant_score < 1 && scores.get('sybilB').sybil_resistant_score < 1);
check('genuine agent earns real weighted trust', scores.get('rich').sybil_resistant_score > 0);
check('genuine >> sybil despite 1000x less raw volume', scores.get('rich').sybil_resistant_score > scores.get('sybilA').sybil_resistant_score);

// --- cascade counterparty-weighting (in-process, JSON mode) ---
mkdirSync(dataDir, { recursive: true });
writeFileSync(join(dataDir, 'agents.json'), JSON.stringify({
  schema: 'axp.agent_registry.v0', network: 'test', agents: [
    { agent_id: 'sponsorX', name: 'Sponsor', status: 'active', services: ['research'], reputation: 1, collateral: { total_usd: 5000 }, available_capacity: 5000, trust_metrics: {} },
    { agent_id: 'provX', name: 'Provider', status: 'active', services: ['research'], reputation: 1, collateral: { total_usd: 1000 }, available_capacity: 1000, trust_metrics: {} },
    { agent_id: 'richReq', name: 'Rich Requester', status: 'active', services: ['task_request'], reputation: 1, collateral: { total_usd: 5000 }, available_capacity: 5000, trust_metrics: {} },
    { agent_id: 'poorReq', name: 'Poor Requester', status: 'active', services: ['task_request'], reputation: 1, collateral: { total_usd: 0 }, available_capacity: 0, trust_metrics: {} },
  ],
}, null, 2));
writeFileSync(join(dataDir, 'contracts.json'), JSON.stringify({
  schema: 'axp.contract_store.v0', contracts: [
    { contract_id: 'c_rich', status: 'settled', quote: { provider_agent_id: 'provX', requester_agent_id: 'richReq', requested_capacity: 1000 } },
    { contract_id: 'c_poor', status: 'settled', quote: { provider_agent_id: 'provX', requester_agent_id: 'poorReq', requested_capacity: 1000 } },
  ],
}, null, 2));

const { registerLineage, distributeDiscoveryRewards } = await import('../src/growth.js');
await registerLineage({ agent_id: 'provX', sponsor_agent_id: 'sponsorX' });

const richDist = await distributeDiscoveryRewards({ provider_agent_id: 'provX', value_usd: 1000, contract_id: 'c_rich' });
check('stake-backed payer => overrides flow', richDist.total_axp > 0 && richDist.counterparty_weight > 0.9);

const poorDist = await distributeDiscoveryRewards({ provider_agent_id: 'provX', value_usd: 1000, contract_id: 'c_poor' });
check('zero-stake payer => zero overrides (sybil defused)', poorDist.total_axp === 0 && poorDist.counterparty_weight === 0);

console.log(`\nAll ${passed} checks passed.`);
