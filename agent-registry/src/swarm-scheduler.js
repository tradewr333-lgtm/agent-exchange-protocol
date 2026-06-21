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
import { loadAgentsRegistry, saveAgentsRegistry, loadContractStore, loadExternalSignals, updateAgentFields } from './store.js';
import { publishIntent, listIntents, fulfillIntent } from './intents.js';
import { executeTask, llmEnabled } from './agent-executor.js';
import { sponsorScion, distributeDiscoveryRewards } from './growth.js';
import { prepareContract, fundContract, acceptContract, settleContract } from './contracts.js';
import { getGrowthMetrics } from './growth.js';
import { buildObservatory } from './observatory.js';
import { publishObservatoryOpportunities } from './observatory-publisher.js';
import { reconcileAllHosting } from './hosting.js';
import { deriveAgentWallet } from './agent-launcher.js';
import { githubIssuesSource } from '../../examples/axp-opportunity-miner/sources.js';
import { workItemToIntent } from '../../examples/axp-opportunity-miner/normalize.js';
import { sampleTaskFor, SAMPLE_SERVICES } from './sample-tasks.js';

// Cover every template's service so launched agents always find real, content-rich work.
const SERVICES = SAMPLE_SERVICES;

// Set when the scheduler boots, so an admin route can trigger a cycle on demand
// (useful on the free tier, where the timer pauses while the service sleeps).
let scheduledTick = null;

export async function runWorkerOnce() {
  if (!scheduledTick) return { ok: false, reason: 'scheduler_not_running' };
  await scheduledTick();
  return { ok: true, ran_at: new Date().toISOString() };
}

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
    return signWith(w, action, agentId, scope);
  }

  async function signWith(wallet, action, agentId, scope) {
    const nonce = '0x' + randomBytes(16).toString('hex');
    const issued_at = new Date().toISOString();
    const message = buildAuthMessage({ action, agentId, address: wallet.address, nonce, issuedAt: issued_at, scope });
    const signature = await wallet.signMessage(message);
    return { agent_id: agentId, address: wallet.address, signature, nonce, issued_at };
  }

  // Hosting worker: keep PAID, launched agents alive and earning. For each agent
  // with active hosting, run one work cycle (prepare -> fund -> accept -> settle),
  // signed by the agent's own derived wallet, then register Proof of Trust.
  async function runHostedAgents() {
    if (process.env.AXP_HOSTING_WORKER === 'false') return;
    const all = process.env.AXP_HOSTING_WORKER_ALL === 'true'; // demo: run launched agents even without a paid sub
    const registry = await loadAgentsRegistry();
    const hosted = registry.agents.filter((a) => a.origin === 'launch' && (a.hosting?.active || all));
    let processed = 0;
    for (const agent of hosted) {
      if (processed >= 5) break;
      try {
        await runHostedAgentCycle(agent);
        processed += 1;
      } catch (err) {
        console.error('hosted_agent_cycle_failed', agent.agent_id, err?.message || err);
      }
    }
    if (processed) console.log(`hosting: ran ${processed} hosted agent cycle(s).`);
  }

  async function runHostedAgentCycle(agent) {
    const provWallet = await deriveAgentWallet(agent.agent_id);
    const aid = agent.agent_id;
    const service = (agent.services && agent.services[0]) || 'research';
    const cap = 100 + Math.floor(Math.random() * 400);

    // Find a real open intent matching this agent's service to work on (real demand).
    let matchedIntent = null;
    try {
      const feed = await listIntents({ status: 'open', service, limit: 20 });
      matchedIntent = (feed.intents || []).find((i) => i.claimed_by == null) || null;
    } catch { /* fall back to a template briefing */ }
    const taskText = matchedIntent
      ? `${matchedIntent.title}\n\n${matchedIntent.description || ''}`.trim()
      : '';

    // REAL WORK: have the agent actually do the task with the LLM (if configured).
    let deliverable = null;
    if (llmEnabled()) {
      const run = await executeTask({ template_id: agent.template, task: taskText, maxTokens: 700 });
      if (run.ok && run.output) {
        deliverable = run;
        try {
          await updateAgentFields(aid, {
            last_work: {
              at: new Date().toISOString(),
              intent_id: matchedIntent?.intent_id ?? null,
              task: (run.task || '').slice(0, 200),
              model: run.model,
              preview: run.output.slice(0, 500),
            },
          });
        } catch (err) { console.error('hosted_last_work_save_failed', aid, err?.message || err); }
      }
    }

    const prep = await prepareContract({
      provider_agent_id: aid, requester_agent_id: requesterId, service,
      requested_capacity: cap, handshake_mode: 'advisory',
      auth: await signWith(provWallet, 'contracts.prepare', aid, `provider:${aid}|requester:${requesterId}|service:${service}|capacity:${cap}`),
    });
    if (!prep.ok) return;
    const cid = prep.contract.contract_id;
    const funded = await fundContract(cid, { payment_asset: 'USDC', auth: await sign('contracts.fund', requesterId, `contract:${cid}|fund:true`) });
    if (!funded.ok) return;
    const accepted = await acceptContract(cid, { auth: await signWith(provWallet, 'contracts.accept', aid, `contract:${cid}|accept:true`) });
    if (!accepted.ok) return;
    const settled = await settleContract(cid, { outcome: 'settled', auth: await signWith(provWallet, 'contracts.settle', aid, `contract:${cid}|outcome:settled`) });
    if (!settled.ok || settled.contract?.status !== 'settled') return;
    await distributeDiscoveryRewards({ contract_id: cid, provider_agent_id: aid, value_usd: cap });

    // Close the loop on real demand: mark the intent fulfilled by this agent.
    if (matchedIntent && deliverable) {
      try { await fulfillIntent(matchedIntent.intent_id, { agent_id: aid, contract_id: cid }); } catch { /* best effort */ }
    }
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
    const w = await getWallet();
    const operator = (w && w.address) || null;
    const registry = await loadAgentsRegistry();
    const byId = new Map(registry.agents.map((a) => [a.agent_id, a]));
    // Upsert the system agents AND refresh their on-chain operator to THIS boot's
    // ephemeral wallet. The wallet is re-minted every boot, so without this the
    // requester's funding signature fails auth (auth_operator_mismatch) after a
    // redeploy — which stalls every contract at "prepared" and blocks trust.
    const refresh = (id, name, services) => {
      const existing = byId.get(id);
      if (!existing) return systemAgent(id, name, services);
      return {
        ...existing,
        manifest: {
          ...(existing.manifest || {}),
          onchain: { ...((existing.manifest || {}).onchain || {}), operator },
        },
      };
    };
    const sponsor = refresh(sponsorId, 'AXP Swarm Sponsor', ['research', 'analysis']);
    const requester = refresh(requesterId, 'AXP Swarm Requester', ['task_request']);
    const others = registry.agents.filter((a) => a.agent_id !== sponsorId && a.agent_id !== requesterId);
    await saveAgentsRegistry({ ...registry, agents: [...others, sponsor, requester] });
    ready = true;
  }

  async function topUpFeed() {
    const open = await listIntents({ status: 'open', limit: 200 });
    const deficit = targetIntents - (open.total ?? open.count ?? 0);
    for (let i = 0; i < Math.min(deficit, 3); i += 1) {
      const service = SERVICES[Math.floor(Math.random() * SERVICES.length)];
      const t = sampleTaskFor(service);
      await publishIntent({
        title: t.title,
        description: t.description, // real payload so deliverables come out complete
        service,
        skills: [service],
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
      await reconcileAllHosting(); // sync owner subscriptions → hosted slots
      await runHostedAgents();
      const metrics = await getGrowthMetrics({ autotune: true });
      if ((metrics.population?.scions ?? 0) < maxScions) {
        await spawnAndSettle();
      }
    } catch (error) {
      console.error('swarm_heartbeat_tick_failed', error?.message || error);
    }
  }

  scheduledTick = tick; // expose for on-demand admin trigger
  console.log(`AXP swarm heartbeat enabled: every ${Math.round(intervalMs / 1000)}s, cap ${maxScions} scions.`);
  setTimeout(tick, 8000); // first run shortly after boot
  return setInterval(tick, intervalMs);
}
