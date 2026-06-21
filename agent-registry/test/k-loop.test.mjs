// End-to-end K-loop test: spins the real HTTP server, sponsors a scion, drives a
// full signed contract lifecycle (prepare -> fund -> accept -> settle), and proves
// the Genesis Cascade activates — K-factor moves from 0 to > 0.
// Run with: AXP_DATA_DIR=<tmp> PORT=<port> node agent-registry/test/k-loop.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ethers } from 'ethers';
import { buildAuthMessage } from '../src/auth.js';

const dataDir = process.env.AXP_DATA_DIR;
const port = Number(process.env.PORT || 4555);
assert.ok(dataDir, 'AXP_DATA_DIR must be set');
assert.ok(!process.env.DATABASE_URL, 'DATABASE_URL must be unset (JSON mode)');

const sponsorWallet = ethers.Wallet.createRandom();
const requesterWallet = ethers.Wallet.createRandom();

function seedAgent(agentId, name, operator, services, capacity) {
  return {
    agent_id: agentId, name, role: 'provider', status: 'active', services,
    reputation: 1, stake_axp: 0,
    collateral: { accounting_unit: 'USD', status: 'seed', assets: [], total_usd: capacity },
    available_capacity: capacity, completed_contracts: 0, failed_contracts: 0, failure_rate: 0,
    trust_metrics: { settled_volume_usd: 0, success_rate: 0, counterparty_diversity: 0, time_weight: 1, failed_volume_usd: 0, disputes_lost: 0, late_delivery_penalties: 0, slashing_events: 0, fraud_flags: 0 },
    heartbeat: { status: 'active', available: true, current_load: 0, available_capacity: capacity, endpoint: null, version: '0.1.0', last_seen_at: new Date().toISOString(), expires_at: '2099-01-01T00:00:00.000Z', scope: 'kloop' },
    manifest: { protocol: 'AXP', version: '0.1.0', identity: `axp:test:${agentId}`, onchain: { network: 'BNB Smart Chain', chain_id: 56, operator } },
  };
}

mkdirSync(dataDir, { recursive: true });
writeFileSync(join(dataDir, 'agents.json'), JSON.stringify({
  schema: 'axp.agent_registry.v0', network: 'test', updated_at: new Date().toISOString(),
  agents: [
    seedAgent('kloop_sponsor', 'K-Loop Sponsor', sponsorWallet.address, ['research'], 5000),
    seedAgent('kloop_requester', 'K-Loop Requester', requesterWallet.address, ['task_request'], 2000),
  ],
}, null, 2));

await import('../server.js');
await new Promise((r) => setTimeout(r, 600));

const base = `http://localhost:${port}`;
async function api(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}
async function sign(wallet, action, agentId, scope) {
  const nonce = '0x' + randomBytes(16).toString('hex');
  const issued_at = new Date().toISOString();
  const message = buildAuthMessage({ action, agentId, address: wallet.address, nonce, issuedAt: issued_at, scope });
  const signature = await wallet.signMessage(message);
  return { agent_id: agentId, address: wallet.address, signature, nonce, issued_at };
}

let passed = 0;
const check = (label, cond) => { assert.ok(cond, label); passed += 1; console.log(`  PASS ${label}`); };

console.log('AXP K-loop — end-to-end test\n');

// Baseline K
const m0 = await api('GET', '/growth/metrics?autotune=false');
check('baseline k_factor is 0', m0.json.k_factor === 0);

// 1) Sponsor a scion (inherits the sponsor operator)
const scionRes = await api('POST', '/growth/sponsor', { sponsor_agent_id: 'kloop_sponsor', service: 'research', committed_capacity_usd: 3000 });
check('scion sponsored', scionRes.status === 201 && scionRes.json.scion?.agent_id);
const scionId = scionRes.json.scion.agent_id;
check('scion inherited sponsor operator', scionRes.json.scion.manifest?.onchain?.operator === sponsorWallet.address);

// 2) Prepare contract: provider (scion) signs the prepare authorization
const prepareScope = `provider:${scionId}|requester:kloop_requester|service:research|capacity:200`;
const prep = await api('POST', '/contracts/prepare', {
  provider_agent_id: scionId, requester_agent_id: 'kloop_requester', service: 'research',
  requested_capacity: 200, handshake_mode: 'advisory',
  auth: await sign(sponsorWallet, 'contracts.prepare', scionId, prepareScope),
});
check('contract prepared', prep.status === 201 && prep.json.contract_id);
const cid = prep.json.contract_id;

// 3) Fund (requester signs)
const fund = await api('POST', `/contracts/${cid}/fund`, {
  payment_asset: 'USDC',
  auth: await sign(requesterWallet, 'contracts.fund', 'kloop_requester', `contract:${cid}|fund:true`),
});
check('contract funded', fund.status === 200 && fund.json.status === 'funded');

// 4) Accept (scion provider signs, via inherited sponsor key)
const accept = await api('POST', `/contracts/${cid}/accept`, {
  auth: await sign(sponsorWallet, 'contracts.accept', scionId, `contract:${cid}|accept:true`),
});
check('contract accepted', accept.status === 200 && accept.json.status === 'active');

// 5) Settle as provider -> triggers discovery overrides up the lineage
const settle = await api('POST', `/contracts/${cid}/settle`, {
  outcome: 'settled',
  auth: await sign(sponsorWallet, 'contracts.settle', scionId, `contract:${cid}|outcome:settled`),
});
check('contract settled', settle.status === 200 && settle.json.status === 'settled');

// 6) The loop closed: scion activated, K-factor leaves 0
const m1 = await api('GET', '/growth/metrics');
check('k_factor moved above 0', m1.json.k_factor > 0);
check('viral status expanding', m1.json.viral_status === 'expanding');
check('a scion is activated', m1.json.population.activated_scions >= 1);
check('treasury emitted discovery rewards', m1.json.treasury.spent_axp > 0);

const lineage = await api('GET', '/growth/lineage');
const sponsorNode = (lineage.json.nodes || []).find((n) => n.agent_id === 'kloop_sponsor');
check('sponsor earned discovery overrides', sponsorNode && sponsorNode.discovery_earnings_axp > 0);

console.log(`\nAll ${passed} checks passed. K-factor: ${m1.json.k_factor}`);
process.exit(0);
