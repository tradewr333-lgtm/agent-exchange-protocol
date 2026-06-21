// AXP K-loop runner — proves real agent-to-agent interaction on a live registry.
// Self-bootstraps with ONE wallet (your operator key): registers a sponsor + a
// requester you operate, sponsors a scion, then drives a full signed contract
// lifecycle (prepare -> fund -> accept -> settle). Settlement fires the Genesis
// Cascade: discovery overrides flow up the lineage and the K-factor leaves 0.
//
// This is OFF-CHAIN registry activity — no gas / no BNB is spent. The wallet key
// is only used locally to sign AXP authorization messages; it never leaves your
// machine and is never sent to the registry.
//
// Usage (from repo root, with blockchain/.env holding BSC_MAINNET_PRIVATE_KEY):
//   AXP_REGISTRY_URL=https://axp.network node examples/axp-k-loop/run.js
import { ethers } from 'ethers';
import { randomBytes } from 'node:crypto';
import { loadBlockchainEnv } from '../proof-of-trust-anchor/load-env.js';
import { buildAuthMessage } from '../../agent-registry/src/auth.js';
import { buildRegistrationScope } from '../../agent-registry/src/agents.js';

const loadedEnvFiles = loadBlockchainEnv();

const registryUrl = (process.env.AXP_REGISTRY_URL ?? 'https://axp.network').replace(/\/$/, '');
const KEY_NAMES = [
  'AXP_OPERATOR_KEY', 'BSC_MAINNET_PRIVATE_KEY', 'BSC_TESTNET_PRIVATE_KEY',
  'PRIVATE_KEY', 'DEPLOYER_PRIVATE_KEY', 'BSC_PRIVATE_KEY', 'OPERATOR_PRIVATE_KEY',
];
let rawKey = KEY_NAMES.map((name) => process.env[name]).find((value) => value && value.trim());
if (rawKey) {
  rawKey = rawKey.trim();
  if (!rawKey.startsWith('0x')) rawKey = '0x' + rawKey;
}
if (!rawKey) {
  const present = KEY_NAMES.filter((name) => process.env[name]);
  console.error('Missing operator key. The wallet key is read locally and never sent anywhere.');
  console.error('Looked in env files:', loadedEnvFiles.length ? loadedEnvFiles.join(', ') : '(none found)');
  console.error('Recognized key variable names:', KEY_NAMES.join(', '));
  console.error('Key vars currently set:', present.length ? present.join(', ') : '(none)');
  console.error('Fix: either rename your key var to one of the above in blockchain/.env, or run with it inline, e.g.:');
  console.error('  set "AXP_OPERATOR_KEY=0xYOURKEY" && node examples/axp-k-loop/run.js');
  process.exit(1);
}

const wallet = new ethers.Wallet(rawKey);
const operator = wallet.address;
const tag = Date.now().toString(36);

async function api(method, path, body) {
  const res = await fetch(`${registryUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
}

async function sign(action, agentId, scope) {
  const nonce = '0x' + randomBytes(16).toString('hex');
  const issued_at = new Date().toISOString();
  const message = buildAuthMessage({ action, agentId, address: operator, nonce, issuedAt: issued_at, scope });
  const signature = await wallet.signMessage(message);
  return { agent_id: agentId, address: operator, signature, nonce, issued_at };
}

async function register(agentId, name, services, amount) {
  const payload = { agent_id: agentId, name, operator, services, collateral: { symbol: 'USDC', amount } };
  const scope = buildRegistrationScope(payload);
  return api('POST', '/agents/register', { ...payload, auth: await sign('agents.register', agentId, scope) });
}

// How many scion -> settle cycles to run this batch (drives activation_rate / K up).
const scionsTarget = (() => {
  const arg = process.argv.find((a) => a.startsWith('--scions='));
  const raw = arg ? arg.split('=')[1] : process.env.AXP_SCIONS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.trunc(n), 25) : 1;
})();

const sponsorId = `kloop_sponsor_${tag}`;
const requesterId = `kloop_requester_${tag}`;
const CAP = 200;

console.log(`Operator ${operator} on ${registryUrl} — activating ${scionsTarget} scion(s)`);

await register(sponsorId, 'K-Loop Sponsor', ['research'], 100000);
await register(requesterId, 'K-Loop Requester', ['task_request'], 100000);
console.log(`Registered sponsor ${sponsorId} and requester ${requesterId}`);

async function activateScion(i) {
  const scion = await api('POST', '/growth/sponsor', {
    sponsor_agent_id: sponsorId, service: 'research', committed_capacity_usd: 1000,
  });
  const scionId = scion.scion.agent_id;
  const prepScope = `provider:${scionId}|requester:${requesterId}|service:research|capacity:${CAP}`;
  const prep = await api('POST', '/contracts/prepare', {
    provider_agent_id: scionId, requester_agent_id: requesterId, service: 'research',
    requested_capacity: CAP, handshake_mode: 'advisory',
    auth: await sign('contracts.prepare', scionId, prepScope),
  });
  const cid = prep.contract_id;
  await api('POST', `/contracts/${cid}/fund`, { payment_asset: 'USDC', auth: await sign('contracts.fund', requesterId, `contract:${cid}|fund:true`) });
  await api('POST', `/contracts/${cid}/accept`, { auth: await sign('contracts.accept', scionId, `contract:${cid}|accept:true`) });
  await api('POST', `/contracts/${cid}/settle`, { outcome: 'settled', auth: await sign('contracts.settle', scionId, `contract:${cid}|outcome:settled`) });
  const m = await api('GET', '/growth/metrics?autotune=false');
  console.log(`  [${i + 1}/${scionsTarget}] ${scionId} settled — K=${m.k_factor} (${m.viral_status}) · activated ${m.population.activated_scions}/${m.population.scions} · reward x${m.incentive.reward_multiplier}`);
  return scionId;
}

const activated = [];
for (let i = 0; i < scionsTarget; i += 1) {
  activated.push(await activateScion(i));
}

const metrics = await api('GET', '/growth/metrics');
console.log(JSON.stringify({
  step: 'k_loop_complete',
  sponsor: sponsorId,
  scions_activated_this_run: activated.length,
  k_factor: metrics.k_factor,
  viral_status: metrics.viral_status,
  reward_multiplier: metrics.incentive?.reward_multiplier,
  activated_scions: metrics.population?.activated_scions,
  total_scions: metrics.population?.scions,
  treasury_spent_axp: metrics.treasury?.spent_axp,
}, null, 2));
