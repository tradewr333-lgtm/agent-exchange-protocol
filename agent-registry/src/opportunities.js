import { listAgents } from './registry.js';
import { calculateAgentTrustScore } from './trust-score.js';
import { listIntents, intentPriorityScore, URGENCY_WEIGHT } from './intents.js';

export const OPPORTUNITY_ROUTER_VERSION = '0.1.0';

// Score how well an agent fits an intent. Returns eligibility + reasons so the
// router can explain itself and so unfillable intents become spawn signals.
export function scoreMatch(intent, agent, trustScore) {
  const reasons = [];
  const blockers = [];

  const requiredCapacity = Number(intent.required_capacity_usd) || 0;
  const availableCapacity = Number(agent.available_capacity) || 0;
  const minTrust = Number(intent.min_trust_score) || 0;
  const agentTrust = Number(trustScore) || 0;

  const serviceStrength = serviceMatchStrength(intent, agent);
  const capacityOk = requiredCapacity === 0 || availableCapacity >= requiredCapacity;
  const trustOk = agentTrust >= minTrust;
  const activeOk = agent.status === 'active';

  if (!activeOk) {
    blockers.push('agent_not_active');
  }
  if (!capacityOk) {
    blockers.push('insufficient_capacity');
  }
  if (!trustOk) {
    blockers.push('insufficient_trust');
  }
  const hasCapabilityRequirement =
    Boolean(intent.service) || (Array.isArray(intent.skills) && intent.skills.length > 0);
  if (hasCapabilityRequirement && serviceStrength === 0) {
    blockers.push('no_specialist_match');
  }

  // Soft score (0-100) even when blocked, so we can rank near-misses.
  const serviceComponent = serviceStrength * 40;
  const capacityComponent = requiredCapacity === 0
    ? 15
    : Math.min(20, (availableCapacity / Math.max(1, requiredCapacity)) * 10);
  const trustComponent = minTrust > 0
    ? Math.min(20, (agentTrust / Math.max(1, minTrust)) * 12)
    : Math.min(20, Math.log10(Math.max(1, agentTrust) + 1) * 4);
  const attractiveness = Math.min(20,
    (URGENCY_WEIGHT[intent.urgency] ?? 2) * 3 + Math.log10(Math.max(1, Number(intent.reward_usd) || 0) + 1) * 2);

  if (serviceStrength >= 1) {
    reasons.push('exact_service_match');
  } else if (serviceStrength > 0) {
    reasons.push('skill_overlap');
  }
  if (capacityOk && requiredCapacity > 0) {
    reasons.push('capacity_sufficient');
  }
  if (trustOk && minTrust > 0) {
    reasons.push('meets_trust_threshold');
  }
  if (Boolean(agent.online)) {
    reasons.push('online_now');
  }

  const score = Number((serviceComponent + capacityComponent + trustComponent + attractiveness).toFixed(2));

  return {
    match_score: score,
    eligible: blockers.length === 0,
    blockers,
    reasons,
    service_strength: Number(serviceStrength.toFixed(2)),
  };
}

export async function getOpportunitiesForAgent(agentId, filters = {}) {
  const { agents } = await listAgents({});
  const agent = agents.find((item) => item.agent_id === agentId);
  if (!agent) {
    return { ok: false, status: 404, error: 'agent_not_found', agent_id: agentId };
  }

  const trustScore = calculateAgentTrustScore(agent).proof_of_trust_score;
  const intents = (await listIntents({ status: 'open', limit: 500 })).intents;
  const limit = normalizeLimit(filters.limit, 25);

  const scored = intents
    .map((intent) => {
      const match = scoreMatch(intent, agent, trustScore);
      return {
        intent_id: intent.intent_id,
        title: intent.title,
        service: intent.service,
        reward_usd: Number(intent.reward_usd) || 0,
        urgency: intent.urgency,
        required_capacity_usd: Number(intent.required_capacity_usd) || 0,
        expires_at: intent.expires_at,
        claim_url: `/intents/${intent.intent_id}/claim`,
        ...match,
      };
    })
    .filter((entry) => (filters.eligibleOnly === false ? true : entry.eligible))
    .sort((left, right) => right.match_score - left.match_score)
    .slice(0, limit);

  return {
    ok: true,
    status: 200,
    protocol: 'AXP',
    version: OPPORTUNITY_ROUTER_VERSION,
    schema: 'axp.opportunities_for_agent.v0',
    agent_id: agentId,
    agent_trust_score: trustScore,
    available_capacity_usd: Number(agent.available_capacity) || 0,
    count: scored.length,
    opportunities: scored,
  };
}

// The Opportunity Graph: live work, idle agents, suggested matches, and the
// spawn signals (intents nobody can fill) that drive the Genesis Cascade.
export async function getOpportunityGraph(filters = {}) {
  const { agents } = await listAgents({});
  const activeAgents = agents
    .filter((agent) => agent.status === 'active')
    .map((agent) => ({ agent, trust: calculateAgentTrustScore(agent).proof_of_trust_score }));

  const openIntents = (await listIntents({ status: 'open', limit: 500 })).intents;
  const limit = normalizeLimit(filters.limit, 25);

  const suggestedMatches = [];
  const spawnOpportunities = [];

  for (const intent of openIntents) {
    let best = null;
    const blockerTally = {};
    for (const { agent, trust } of activeAgents) {
      const match = scoreMatch(intent, agent, trust);
      for (const blocker of match.blockers) {
        blockerTally[blocker] = (blockerTally[blocker] ?? 0) + 1;
      }
      if (match.eligible && (!best || match.match_score > best.match_score)) {
        best = { agent_id: agent.agent_id, agent_name: agent.name, ...match };
      }
    }

    if (best) {
      suggestedMatches.push({
        intent_id: intent.intent_id,
        title: intent.title,
        service: intent.service,
        reward_usd: Number(intent.reward_usd) || 0,
        urgency: intent.urgency,
        best_agent: best,
      });
    } else {
      spawnOpportunities.push({
        intent_id: intent.intent_id,
        title: intent.title,
        service: intent.service,
        reward_usd: Number(intent.reward_usd) || 0,
        urgency: intent.urgency,
        required_capacity_usd: Number(intent.required_capacity_usd) || 0,
        min_trust_score: Number(intent.min_trust_score) || 0,
        priority_score: intentPriorityScore(intent),
        unmet_reasons: dominantBlockers(blockerTally, activeAgents.length),
        sponsor_hint: 'No active agent can fill this. Sponsor a scion via POST /growth/sponsor to capture the reward.',
      });
    }
  }

  suggestedMatches.sort((a, b) => (b.best_agent?.match_score ?? 0) - (a.best_agent?.match_score ?? 0));
  spawnOpportunities.sort((a, b) => b.priority_score - a.priority_score);

  const idleAgents = activeAgents
    .filter(({ agent }) => Number(agent.available_capacity) > 0)
    .sort((a, b) => Number(b.agent.available_capacity) - Number(a.agent.available_capacity))
    .slice(0, limit)
    .map(({ agent, trust }) => ({
      agent_id: agent.agent_id,
      agent_name: agent.name,
      services: agent.services,
      available_capacity_usd: Number(agent.available_capacity) || 0,
      trust_score: trust,
      online: Boolean(agent.online),
    }));

  const unclaimedRewardUsd = openIntents.reduce((sum, intent) => sum + (Number(intent.reward_usd) || 0), 0);

  return {
    protocol: 'AXP',
    version: OPPORTUNITY_ROUTER_VERSION,
    schema: 'axp.opportunity_graph.v0',
    generated_at: new Date().toISOString(),
    stats: {
      open_intents: openIntents.length,
      active_agents: activeAgents.length,
      idle_agents: idleAgents.length,
      matched_intents: suggestedMatches.length,
      spawn_opportunities: spawnOpportunities.length,
      unclaimed_reward_usd: Number(unclaimedRewardUsd.toFixed(2)),
    },
    suggested_matches: suggestedMatches.slice(0, limit),
    idle_agents: idleAgents,
    spawn_opportunities: spawnOpportunities.slice(0, limit),
  };
}

function serviceMatchStrength(intent, agent) {
  const services = Array.isArray(agent.services) ? agent.services : [];
  if (intent.service && services.includes(intent.service)) {
    return 1;
  }
  const skills = Array.isArray(intent.skills) ? intent.skills : [];
  if (skills.length === 0) {
    return intent.service ? 0 : 0.5;
  }
  const overlap = skills.filter((skill) => services.includes(skill)).length;
  return overlap === 0 ? 0 : Math.min(1, overlap / skills.length);
}

function dominantBlockers(tally, agentCount) {
  if (agentCount === 0) {
    return ['no_active_agents'];
  }
  return Object.entries(tally)
    .filter(([, count]) => count === agentCount)
    .map(([reason]) => reason);
}

function normalizeLimit(value, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }
  return Math.min(Math.trunc(number), 200);
}
