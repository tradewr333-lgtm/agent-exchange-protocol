// In-process swarm heartbeat: keeps the AXP network visibly alive without any
// external machine or user key. Runs ENTIRELY server-side on a timer.
//
// It is SYNTHETIC demo activity (the protocol exercising its own lifecycle with
// system-owned agents), not organic third-party adoption. Disabled by default;
// enable with AXP_SWARM_ENABLED=true. The server mints an ephemeral wallet at
// boot (held in memory only, never persisted) to sign the system agents' actions,
// so no user private key is involved.
import { randomBytes } from 'node:crypto';
import { buildAuthMessage } from './auth.js';
import { loadAgentsRegistry, saveAgentsRegistry, loadContractStore, loadExternalSignals } from './store.js';
import { publishIntent, listIntents } from './intents.js';
import { sponsorScion, distributeDiscoveryRewards } from './growth.js';
import { prepareContract, fundContract, acceptContract, settleContract } from './contracts.js';
import { getGrowthMetrics } from './growth.js';
import { buildObservatory } from './observatory.js';
import { publishObservatoryOpportunities } from './observatory-publisher.js';
import { githubIssuesSource } from '../../examples/axp-opportunity-miner/sources.js';
import { workItemToIntent } from '../../examples/axp-opportunity-miner/normalize.js';

const SERVICES = ['research', 'data_processing', 'content_writing', 'analysis'];
const SAMPLE_TITLES = [
  'Summarize the latest agent framework releases',
  'Classify a batch of on-chain transactions',
  'Draft a short market brief',
  'Analyze counterparty risk for a new agent',
  'Translate a product page',
];

export function startSwarmScheduler() {
  if (process.env.AXP_SWARM_ENABLED !== 'true') return null;
  const intervalMs = Math.max(60_000, Number(process.env.AXP_SWARM_INTERVAL_MS) || 600_000);
  const maxScions = Number(process.env.AXP_SWARM_MAX_SCIONS) || 50;
  const targetIntents = Number(process.env.AXP_SWARM_TARGET_INTENTS) || 8;

  let wallet = null;
  let ready = false;
  const sponsorId = 'system_swarm_sponsor';
  const requesterId = 'system_swarm_requester';

  async function getWallet() {
    if (!wallet) {
      const { Wallet } = await import('ethers');
      wallet = Wallet.createRandom();
    }
    return wallet;
  }

  async function sign(action, agentId, scope) {
    const w = await getWallet();
    const nonce = '0x' + randomBytes(16).toString('hex');
    const issued_at = new Date().toISOString();
    const message = buildAuthMessage({ action, agentId, address: w.address, nonce, issuedAt: issued_at, scope });
    const signature = await w.signMessage(message);
    return { agent_id: agentId, address: w.address, signature, nonce, issued_at };
  }

  function systemAgent(id, name, services) {
    return {
      agent_id: id, name, role: 'provider', status: 'active', services,
      reputation: 1, stake_axp: 0,
      collateral: { accounting_unit: 'USD', status: 'system', assets: [], total_usd: 1_000_000 },
      available_capacity: 1_000_000, completed_contracts: 0, failed_contracts: 0, failure_rate: 0,
      trust_metrics: { settled_volume_usd: 0, success_rate: 0, counterparty_diversity: 0, time_weight: 1, failed_volume_usd: 0, disputes_lost: 0, late_delivery_penalties: 0, slashing_events: 0, fraud_flags: 0 },
      heartbeat: { status: 'active', available: true, current_load: 0, available_capacity: 1_000_000, endpoint: null, version: '0.1.0', last_seen_at: new Date().toISOString(), expires_at: '2099-01-01T00:00:00.000Z', scope: 'swarm_heartbeat' },
      manifest: { protocol: 'AXP', version: '0.1.0', identity: `axp:system:${id}`, origin: 'swarm_heartbeat', onchain: { network: 'BNB Smart Chain', chain_id: 56, operator: (wallet && wallet.address) || null } },
    };
  }

  async function ensureSystemAgents() {
    if (ready) return;
    await getWallet();
    const registry = await loadAgentsRegistry();
    const have = new Set(registry.agents.map((a) => a.agent_id));
    const toAdd = [];
    if (!have.has(sponsorId)) toAdd.push(systemAgent(sponsorId, 'AXP Swarm Sponsor', ['research', 'analysis']));
    if (!have.has(requesterId)) toAdd.push(systemAgent(requesterId, 'AXP Swarm Requester', ['task_request']));
    if (toAdd.length) {
      await saveAgentsRegistry({ ...registry, agents: [...registry.agents, ...toAdd] });
    }
    ready = true;
  }

  async function topUpFeed() {
    const open = await listIntents({ status: 'open', limit: 200 });
    const deficit = targetIntents - (open.total ?? open.count ?? 0);
    for (let i = 0; i < Math.min(deficit, 3); i += 1) {
      const idx = Math.floor(Math.random() * SAMPLE_TITLES.length);
      await publishIntent({
        title: SAMPLE_TITLES[idx],
        service: SERVICES[idx % SERVICES.length],
        reward_usd: 200 + Math.floor(Math.random() * 1800),
        urgency: ['LOW', 'MEDIUM', 'HIGH'][Math.floor(Math.random() * 3)],
        required_capacity_usd: 100,
        source: 'swarm_heartbeat',
      });
    }
  }

  // Optional: pull REAL demand from GitHub issues onto the live feed.
  // Enable by setting AXP_MINE_GITHUB_REPOS="owner/repo,owner/repo".
  async function mineGithub() {
    const repos = (process.env.AXP_MINE_GITHUB_REPOS || '').split(',').map((r) => r.trim()).filter(Boolean);
    if (!repos.length) return;
    const labels = process.env.AXP_MINE_GITHUB_LABELS ?? 'bounty,help wanted';
    const existing = await listIntents({ status: 'open', limit: 300 });
    const seen = new Set((existing.intents || []).map((i) => i.source_uri).filter(Boolean));
    let published = 0;
    for (const repo of repos) {
      if (published >= 5) break;
      const items = await githubIssuesSource({ repo, labels });
      for (const item of items) {
        if (published >= 5) break;
        const intent = workItemToIntent(item);
        if (!intent || !intent.source_uri || seen.has(intent.source_uri)) continue;
        await publishIntent(intent);
        seen.add(intent.source_uri);
        published += 1;
      }
    }
    if (published) console.log(`swarm_heartbeat: mined ${published} real GitHub intent(s).`);
  }

  // AXP Venture Studio: turn underserved, well-paid, growing categories into
  // Opportunity Intents that network agents compete to capture. Opt-out with
  // AXP_OBSERVATORY_PUBLISH=false. The protocol publishes demand; it never executes it.
  async function publishObservatory() {
    if (process.env.AXP_OBSERVATORY_PUBLISH === 'false') return;
    const [registry, intents, contractStore, externalSignals] = await Promise.all([
      loadAgentsRegistry(),
      listIntents({ limit: 500 }),
      loadContractStore(),
      loadExternalSignals({ sinceMs: 14 * 24 * 60 * 60 * 1000 }),
    ]);
    const observatory = buildObservatory({
      agents: registry.agents,
      intents: intents.intents,
      contracts: contractStore.contracts,
      externalSignals,
    });
    const created = await publishObservatoryOpportunities({
      observatory,
      existingIntents: intents.intents,
      max: 2,
    });
    if (created.length) console.log(`observatory: published ${created.length} opportunity intent(s).`);
  }

  async function spawnAndSettle() {
    const service = SERVICES[Math.floor(Math.random() * SERVICES.length)];
    const spawned = await sponsorScion({ sponsor_agent_id: sponsorId, service, committed_capacity_usd: 1000 });
    if (!spawned.ok) return;
    const scionId = spawned.scion.agent_id;
    const cap = 100 + Math.floor(Math.random() * 400);

    const prep = await prepareContract({
      provider_agent_id: scionId, requester_agent_id: requesterId, service,
      requested_capacity: cap, handshake_mode: 'advisory',
      auth: await sign('contracts.prepare', scionId, `provider:${scionId}|requester:${requesterId}|service:${service}|capacity:${cap}`),
    });
    if (!prep.ok) return;
    const cid = prep.contract.contract_id;

    const funded = await fundContract(cid, { payment_asset: 'USDC', auth: await sign('contracts.fund', requesterId, `contract:${cid}|fund:true`) });
    if (!funded.ok) return;
    const accepted = await acceptContract(cid, { auth: await sign('contracts.accept', scionId, `contract:${cid}|accept:true`) });
    if (!accepted.ok) return;
    const settled = await settleContract(cid, { outcome: 'settled', auth: await sign('contracts.settle', scionId, `contract:${cid}|outcome:settled`) });
    if (!settled.ok || settled.contract?.status !== 'settled') return;

    await distributeDiscoveryRewards({ contract_id: cid, provider_agent_id: scionId, value_usd: cap });
  }

  async function tick() {
    try {
      await ensureSystemAgents();
      await mineGithub();
      await topUpFeed();
      await publishObservatory();
      const metrics = await getGrowthMetrics({ autotune: true });
      if ((metrics.population?.scions ?? 0) < maxScions) {
        await spawnAndSettle();
      }
    } catch (error) {
      console.error('swarm_heartbeat_tick_failed', error?.message || error);
    }
  }

  console.log(`AXP swarm heartbeat enabled: every ${Math.round(intervalMs / 1000)}s, cap ${maxScions} scions.`);
  setTimeout(tick, 8000); // first run shortly after boot
  return setInterval(tick, intervalMs);
}
