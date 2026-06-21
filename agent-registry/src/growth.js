import { randomUUID } from 'node:crypto';
import {
  appendDiscoveryReward,
  appendInboxMessage,
  appendTrustEvent,
  listDiscoveryRewards,
  loadAgentsRegistry,
  loadGrowthState,
  loadLineage,
  getLineageNode,
  saveAgentsRegistry,
  saveGrowthState,
  saveLineageNode,
} from './store.js';
import { getAgent } from './registry.js';

export const GENESIS_CASCADE_VERSION = '0.1.0';

// Multi-level discovery override: fraction of a settled contract's value that is
// emitted (as AXP discovery credits) to each ancestor that spawned the provider.
// Decaying + depth-capped => bounded emissions, strong incentive to spawn near the top.
export const OVERRIDE_SCHEDULE = [0.1, 0.05, 0.03, 0.02, 0.01];
export const MAX_DEPTH = OVERRIDE_SCHEDULE.length;
export const REWARD_MULTIPLIER_BOUNDS = { min: 0.5, max: 2.0 };
const DEFAULT_STATE = Object.freeze({
  id: 'singleton',
  reward_multiplier: 1,
  treasury_budget_axp: 10_000_000,
  treasury_spent_axp: 0,
  target_k: 1.5,
});

export async function getGrowthState() {
  const state = await loadGrowthState();
  if (state) {
    return { ...DEFAULT_STATE, ...state };
  }
  return saveGrowthState({ ...DEFAULT_STATE });
}

// Register/refresh a lineage node. Sponsor can be referenced by id or axp:// handle.
export async function registerLineage(input = {}) {
  const agentId = typeof input.agent_id === 'string' ? input.agent_id.trim() : '';
  if (!agentId) {
    return { ok: false, status: 400, error: 'agent_id_required' };
  }

  let sponsor = null;
  if (input.sponsor_agent_id || input.sponsor_handle) {
    sponsor = await resolveSponsor(input.sponsor_agent_id, input.sponsor_handle);
    if (!sponsor) {
      return { ok: false, status: 404, error: 'sponsor_not_found' };
    }
  }

  const node = {
    agent_id: agentId,
    handle: normalizeHandle(input.handle) ?? `axp://${agentId}`,
    sponsor_agent_id: sponsor ? sponsor.agent_id : null,
    depth: sponsor ? Number(sponsor.depth ?? 0) + 1 : 0,
    origin: input.origin ?? (sponsor ? 'referral' : 'root'),
    spawned_for_intent: input.spawned_for_intent ?? null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await saveLineageNode(node);
  return { ok: true, status: 201, lineage: node };
}

// Agent Genesis Cascade: a sponsor spends to mint a specialized scion that targets
// a specific unfillable intent/service. Sponsor earns a multi-level override on the
// scion's future settled volume. Money-on-the-table => every agent spawns more agents.
export async function sponsorScion(input = {}) {
  const sponsorId = typeof input.sponsor_agent_id === 'string' ? input.sponsor_agent_id.trim() : '';
  if (!sponsorId) {
    return { ok: false, status: 400, error: 'sponsor_agent_id_required' };
  }

  const sponsor = await getAgent(sponsorId);
  if (!sponsor) {
    return { ok: false, status: 404, error: 'sponsor_not_found', agent_id: sponsorId };
  }

  const service = input.service ?? null;
  const skills = Array.isArray(input.skills) ? input.skills.filter((s) => typeof s === 'string') : [];
  if (!service && skills.length === 0) {
    return { ok: false, status: 400, error: 'service_or_skills_required' };
  }

  const committedCapacity = nonNegative(input.committed_capacity_usd) || 1000;
  const registry = await loadAgentsRegistry();
  const scionId = `scion_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const now = new Date().toISOString();

  const scion = {
    agent_id: scionId,
    name: input.name ?? `Scion of ${sponsor.name ?? sponsorId}`,
    role: 'provider',
    status: 'active',
    services: service ? [service, ...skills.filter((s) => s !== service)] : skills,
    reputation: 1,
    stake_axp: 0,
    collateral: {
      accounting_unit: 'USD',
      status: 'sponsor_committed',
      assets: [
        {
          symbol: 'USDC',
          amount: committedCapacity,
          usd_value: committedCapacity,
          role: 'sponsor_committed_collateral',
        },
      ],
      total_usd: committedCapacity,
    },
    available_capacity: committedCapacity,
    completed_contracts: 0,
    failed_contracts: 0,
    failure_rate: 0,
    trust_metrics: {
      settled_volume_usd: 0,
      success_rate: 0,
      counterparty_diversity: 0,
      time_weight: 1,
      failed_volume_usd: 0,
      disputes_lost: 0,
      late_delivery_penalties: 0,
      slashing_events: 0,
      fraud_flags: 0,
    },
    heartbeat: {
      status: 'active',
      available: true,
      current_load: 0,
      available_capacity: committedCapacity,
      endpoint: null,
      version: '0.1.0',
      last_seen_at: now,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      scope: 'genesis_cascade',
    },
    manifest: {
      protocol: 'AXP',
      version: '0.1.0',
      identity: `axp:${registry.network ?? 'local-demo'}:${scionId}`,
      origin: 'genesis_cascade',
      sponsor_agent_id: sponsorId,
      // A scion is operated by its sponsor: inherit the operator so the sponsor's
      // key can sign accept/settle on the scion's behalf (enables real contracts).
      onchain: sponsor.manifest?.onchain?.operator
        ? {
            network: sponsor.manifest.onchain.network ?? 'BNB Smart Chain',
            chain_id: sponsor.manifest.onchain.chain_id ?? 56,
            operator: sponsor.manifest.onchain.operator,
          }
        : undefined,
    },
  };

  await saveAgentsRegistry({ ...registry, agents: [...registry.agents, scion] });

  // Lineage edge sponsor -> scion (depth from sponsor, capped at MAX_DEPTH for override).
  const sponsorNode = (await getLineageNode(sponsorId)) ?? (await ensureLineageNode(sponsorId));
  const scionNode = {
    agent_id: scionId,
    handle: `axp://${scionId}`,
    sponsor_agent_id: sponsorId,
    depth: Number(sponsorNode.depth ?? 0) + 1,
    origin: 'genesis_cascade',
    spawned_for_intent: input.intent_id ?? null,
    created_at: now,
    updated_at: now,
  };
  await saveLineageNode(scionNode);

  await appendTrustEvent({
    event_type: 'scion_spawned',
    agent_id: scionId,
    counterparty_id: sponsorId,
    value_usd: committedCapacity,
    data: { service, skills, intent_id: input.intent_id ?? null, origin: 'genesis_cascade' },
  });

  await appendInboxMessage({
    agent_id: sponsorId,
    kind: 'scion_spawned',
    subject: `You sponsored ${scion.name}`,
    from_id: 'axp://protocol',
    ref_id: scionId,
    value_usd: 0,
    data: {
      scion_id: scionId,
      service,
      committed_capacity_usd: committedCapacity,
      override_schedule: OVERRIDE_SCHEDULE,
      note: 'You now earn a multi-level discovery override on this scion\'s settled volume.',
    },
  });

  await appendInboxMessage({
    agent_id: scionId,
    kind: 'genesis_welcome',
    subject: 'You were spawned by the Genesis Cascade',
    from_id: `axp://${sponsorId}`,
    ref_id: input.intent_id ?? null,
    value_usd: 0,
    data: {
      sponsor_agent_id: sponsorId,
      target_service: service,
      target_intent: input.intent_id ?? null,
      next: 'Poll GET /opportunities/for/' + scionId + ' and claim matching intents.',
    },
  });

  return {
    ok: true,
    status: 201,
    protocol: 'AXP',
    version: GENESIS_CASCADE_VERSION,
    scion,
    lineage: scionNode,
    override_schedule: OVERRIDE_SCHEDULE,
  };
}

// Called on successful settlement: emit discovery overrides up the scion's lineage.
export async function distributeDiscoveryRewards(input = {}) {
  const providerId = input.provider_agent_id;
  const value = Number(input.value_usd) || 0;
  if (!providerId || value <= 0) {
    return { ok: true, status: 200, distributed: [], total_axp: 0, reason: 'no_provider_or_value' };
  }

  const state = await getGrowthState();
  const multiplier = clamp(Number(state.reward_multiplier) || 1, REWARD_MULTIPLIER_BOUNDS.min, REWARD_MULTIPLIER_BOUNDS.max);
  let budgetLeft = Math.max(0, Number(state.treasury_budget_axp) - Number(state.treasury_spent_axp));

  const chain = await ancestorChain(providerId);
  const distributed = [];
  let totalAxp = 0;

  for (let level = 0; level < chain.length && level < MAX_DEPTH; level += 1) {
    if (budgetLeft <= 0) {
      break;
    }
    const beneficiary = chain[level];
    const gross = value * OVERRIDE_SCHEDULE[level] * multiplier;
    const amount = Number(Math.min(gross, budgetLeft).toFixed(6));
    if (amount <= 0) {
      continue;
    }

    const reward = await appendDiscoveryReward({
      beneficiary_agent_id: beneficiary,
      source_agent_id: providerId,
      contract_id: input.contract_id ?? null,
      intent_id: input.intent_id ?? null,
      level: level + 1,
      amount_axp: amount,
      reward_multiplier: multiplier,
      data: { value_usd: value, schedule_rate: OVERRIDE_SCHEDULE[level] },
    });

    await appendInboxMessage({
      agent_id: beneficiary,
      kind: 'discovery_reward',
      subject: `Discovery override (L${level + 1}) from ${providerId}`,
      from_id: 'axp://protocol',
      ref_id: input.contract_id ?? null,
      value_usd: 0,
      data: { amount_axp: amount, level: level + 1, source_agent_id: providerId },
    });

    budgetLeft -= amount;
    totalAxp += amount;
    distributed.push({ beneficiary_agent_id: beneficiary, level: level + 1, amount_axp: amount, reward_id: reward.id });
  }

  if (totalAxp > 0) {
    await saveGrowthState({
      ...state,
      treasury_spent_axp: Number((Number(state.treasury_spent_axp) + totalAxp).toFixed(6)),
    });
  }

  return {
    ok: true,
    status: 200,
    protocol: 'AXP',
    version: GENESIS_CASCADE_VERSION,
    schema: 'axp.discovery_distribution.v0',
    contract_id: input.contract_id ?? null,
    provider_agent_id: providerId,
    value_usd: value,
    reward_multiplier: multiplier,
    total_axp: Number(totalAxp.toFixed(6)),
    distributed,
  };
}

// K-factor (viral coefficient) + treasury health + deterministic auto-tune.
export async function getGrowthMetrics(options = {}) {
  const lineage = await loadLineage();
  const state = await getGrowthState();
  const rewards = await listDiscoveryRewards({ limit: 500 });

  const totalNodes = lineage.length;
  const scions = lineage.filter((node) => node.sponsor_agent_id);
  const sponsorIds = new Set(scions.map((node) => node.sponsor_agent_id));
  const sponsorsCount = sponsorIds.size;
  const avgScionsPerSponsor = sponsorsCount > 0 ? scions.length / sponsorsCount : 0;

  // A scion is "activated" once it has produced at least one discovery reward as the source.
  const activeSources = new Set(rewards.map((reward) => reward.source_agent_id).filter(Boolean));
  const activatedScions = scions.filter((node) => activeSources.has(node.agent_id)).length;
  const activationRate = scions.length > 0 ? activatedScions / scions.length : 0;

  const kFactor = Number((avgScionsPerSponsor * activationRate).toFixed(4));
  const targetK = Number(state.target_k) || DEFAULT_STATE.target_k;

  // Auto-tune the reward multiplier toward target K, with a bounded ±25% step.
  const ratio = targetK / Math.max(0.25, kFactor);
  const stepFactor = clamp(ratio, 0.8, 1.25);
  const tunedMultiplier = Number(
    clamp((Number(state.reward_multiplier) || 1) * stepFactor, REWARD_MULTIPLIER_BOUNDS.min, REWARD_MULTIPLIER_BOUNDS.max)
      .toFixed(4),
  );

  let appliedMultiplier = Number(state.reward_multiplier) || 1;
  if (options.autotune !== false && tunedMultiplier !== appliedMultiplier) {
    const saved = await saveGrowthState({ ...state, reward_multiplier: tunedMultiplier });
    appliedMultiplier = saved.reward_multiplier;
  }

  const treasuryBudget = Number(state.treasury_budget_axp) || 0;
  const treasurySpent = Number(state.treasury_spent_axp) || 0;

  return {
    protocol: 'AXP',
    version: GENESIS_CASCADE_VERSION,
    schema: 'axp.growth_metrics.v0',
    generated_at: new Date().toISOString(),
    k_factor: kFactor,
    target_k: targetK,
    viral_status: kFactor >= 1 ? 'expanding' : 'sub_critical',
    population: {
      lineage_nodes: totalNodes,
      roots: totalNodes - scions.length,
      scions: scions.length,
      sponsors: sponsorsCount,
      avg_scions_per_sponsor: Number(avgScionsPerSponsor.toFixed(4)),
      activated_scions: activatedScions,
      activation_rate: Number(activationRate.toFixed(4)),
    },
    treasury: {
      budget_axp: treasuryBudget,
      spent_axp: Number(treasurySpent.toFixed(6)),
      remaining_axp: Number(Math.max(0, treasuryBudget - treasurySpent).toFixed(6)),
      utilization: treasuryBudget > 0 ? Number((treasurySpent / treasuryBudget).toFixed(6)) : 0,
    },
    incentive: {
      reward_multiplier: appliedMultiplier,
      override_schedule: OVERRIDE_SCHEDULE,
      max_depth: MAX_DEPTH,
      autotuned: options.autotune !== false,
    },
  };
}

export async function getLineage(filters = {}) {
  const lineage = await loadLineage();
  const rewards = await listDiscoveryRewards({ limit: 500 });
  const earningsByAgent = {};
  for (const reward of rewards) {
    earningsByAgent[reward.beneficiary_agent_id] =
      (earningsByAgent[reward.beneficiary_agent_id] ?? 0) + Number(reward.amount_axp || 0);
  }

  const nodes = lineage.map((node) => ({
    agent_id: node.agent_id,
    handle: node.handle,
    sponsor_agent_id: node.sponsor_agent_id,
    depth: node.depth,
    origin: node.origin,
    discovery_earnings_axp: Number((earningsByAgent[node.agent_id] ?? 0).toFixed(6)),
  }));

  const edges = lineage
    .filter((node) => node.sponsor_agent_id)
    .map((node) => ({ from: node.sponsor_agent_id, to: node.agent_id, depth: node.depth }));

  let filtered = nodes;
  if (filters.agentId) {
    filtered = nodes.filter(
      (node) => node.agent_id === filters.agentId || node.sponsor_agent_id === filters.agentId,
    );
  }

  return {
    protocol: 'AXP',
    version: GENESIS_CASCADE_VERSION,
    schema: 'axp.lineage.v0',
    count: filtered.length,
    nodes: filtered,
    edges,
  };
}

async function ancestorChain(agentId) {
  const chain = [];
  const seen = new Set([agentId]);
  let current = await getLineageNode(agentId);
  let depth = 0;
  while (current && current.sponsor_agent_id && depth < MAX_DEPTH) {
    const sponsorId = current.sponsor_agent_id;
    if (seen.has(sponsorId)) {
      break;
    }
    seen.add(sponsorId);
    chain.push(sponsorId);
    current = await getLineageNode(sponsorId);
    depth += 1;
  }
  return chain;
}

async function ensureLineageNode(agentId) {
  const existing = await getLineageNode(agentId);
  if (existing) {
    return existing;
  }
  const node = {
    agent_id: agentId,
    handle: `axp://${agentId}`,
    sponsor_agent_id: null,
    depth: 0,
    origin: 'root',
    spawned_for_intent: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await saveLineageNode(node);
  return node;
}

async function resolveSponsor(sponsorAgentId, sponsorHandle) {
  if (sponsorAgentId) {
    return ensureLineageNode(sponsorAgentId);
  }
  if (sponsorHandle) {
    const handle = normalizeHandle(sponsorHandle);
    const lineage = await loadLineage();
    return lineage.find((node) => node.handle === handle) ?? null;
  }
  return null;
}

function normalizeHandle(handle) {
  if (typeof handle !== 'string' || !handle.trim()) {
    return null;
  }
  const trimmed = handle.trim();
  return trimmed.startsWith('axp://') ? trimmed : `axp://${trimmed}`;
}

function nonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
