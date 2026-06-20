import { getAgent, listAgents } from './registry.js';

export const PROOF_OF_TRUST_VERSION = '0.1.0';

export async function getAgentTrustScore(agentId) {
  const agent = await getAgent(agentId);
  if (!agent) {
    return null;
  }

  return calculateAgentTrustScore(agent);
}

export async function getAgentRiskReport(agentId) {
  const agent = await getAgent(agentId);
  if (!agent) {
    return null;
  }

  const score = calculateAgentTrustScore(agent);
  const capacity = Math.max(0, Number(agent.available_capacity ?? 0));
  const disputeRate = score.settled_volume_usd > 0
    ? Math.min(1, (score.disputes_lost + score.slashing_events + score.fraud_flags) / Math.max(1, agent.completed_contracts ?? 1))
    : 1;
  const risk = classifyRisk(score, capacity, disputeRate);
  const recommendedLimit = Math.max(0, Math.min(capacity, score.proof_of_trust_score * riskLimitMultiplier(risk)));

  return {
    protocol: 'AXP',
    version: PROOF_OF_TRUST_VERSION,
    schema: 'axp.risk_report.v0',
    status: 'experimental',
    agent_id: agent.agent_id,
    agent_name: agent.name,
    risk,
    confidence: confidenceFromScore(score, agent),
    recommended_limit_usd: round(recommendedLimit),
    trust_score: score.proof_of_trust_score,
    settled_volume_usd: score.settled_volume_usd,
    success_rate: score.success_rate,
    dispute_rate: round(disputeRate),
    online: score.online,
    capacity_free: round(capacity),
    insurance: false,
    oracle_note: 'AXP Trust API is a risk signal, not a guarantee of performance.',
  };
}

export async function getTrustRanking(filters = {}) {
  const minScore = filters.minScore === undefined ? undefined : Number(filters.minScore);
  const limit = filters.limit === undefined ? undefined : Number(filters.limit);
  let rankedAgents = (await listAgents({
    status: filters.status,
    service: filters.service,
    online: filters.online,
  })).agents.map(calculateAgentTrustScore);

  if (Number.isFinite(minScore)) {
    rankedAgents = rankedAgents.filter((score) => score.proof_of_trust_score >= minScore);
  }

  rankedAgents = rankedAgents
    .sort((left, right) => {
      if (right.proof_of_trust_score !== left.proof_of_trust_score) {
        return right.proof_of_trust_score - left.proof_of_trust_score;
      }

      if (right.settled_volume_usd !== left.settled_volume_usd) {
        return right.settled_volume_usd - left.settled_volume_usd;
      }

      return left.agent_id.localeCompare(right.agent_id);
    })
    .map((score, index) => ({
      rank: index + 1,
      ...score,
    }));

  if (Number.isFinite(limit) && limit > 0) {
    rankedAgents = rankedAgents.slice(0, limit);
  }

  return {
    protocol: 'AXP',
    version: PROOF_OF_TRUST_VERSION,
    schema: 'axp.trust_ranking.v0',
    status: 'experimental',
    ranking_method: 'proof_of_trust_score_desc',
    count: rankedAgents.length,
    filters: {
      status: filters.status ?? null,
      service: filters.service ?? null,
      online: filters.online ?? null,
      min_score: Number.isFinite(minScore) ? minScore : null,
      limit: Number.isFinite(limit) && limit > 0 ? limit : null,
    },
    agents: rankedAgents,
  };
}

export async function getBestAgent(filters = {}) {
  const limit = filters.limit === undefined ? 5 : Number(filters.limit);
  const requestedCapacity = filters.requestedCapacity === undefined ? undefined : Number(filters.requestedCapacity);
  const ranking = await getTrustRanking({
    status: filters.status ?? 'active',
    service: filters.task ?? filters.service,
    online: filters.online ?? true,
    minScore: filters.minScore,
    limit: Number.isFinite(limit) && limit > 0 ? limit : 5,
  });

  let candidates = ranking.agents;
  if (Number.isFinite(requestedCapacity) && requestedCapacity > 0) {
    candidates = candidates.filter((agent) => Number(agent.capacity_free ?? 0) >= requestedCapacity);
  }

  return {
    protocol: 'AXP',
    version: PROOF_OF_TRUST_VERSION,
    schema: 'axp.best_agent.v0',
    status: 'experimental',
    task: filters.task ?? filters.service ?? null,
    requested_capacity_usd: Number.isFinite(requestedCapacity) ? requestedCapacity : null,
    selection_method: 'online_active_agents_by_proof_of_trust_score',
    count: candidates.length,
    recommended: candidates.map((agent) => ({
      agent_id: agent.agent_id,
      agent_name: agent.agent_name,
      trust_score: agent.proof_of_trust_score,
      risk: classifyRisk(agent, Number(agent.capacity_free ?? 0), 0),
      capacity_free: agent.capacity_free,
      online: agent.online,
      endpoint: agent.heartbeat?.endpoint ?? null,
    })),
  };
}

export function calculateAgentTrustScore(agent) {
  const metrics = agent.trust_metrics ?? {};
  const settledVolumeUsd = numeric(metrics.settled_volume_usd, 0);
  const successRate = clamp(numeric(metrics.success_rate, fallbackSuccessRate(agent)), 0, 1);
  const counterpartyDiversity = Math.max(0, numeric(metrics.counterparty_diversity, 0));
  const timeWeight = Math.max(0, numeric(metrics.time_weight, 1));
  const failedVolumeUsd = Math.max(0, numeric(metrics.failed_volume_usd, fallbackFailedVolume(agent)));
  const disputesLost = Math.max(0, numeric(metrics.disputes_lost, 0));
  const lateDeliveryPenalties = Math.max(0, numeric(metrics.late_delivery_penalties, 0));
  const slashingEvents = Math.max(0, numeric(metrics.slashing_events, agent.status === 'slashed' ? 1 : 0));
  const fraudFlags = Math.max(0, numeric(metrics.fraud_flags, 0));

  const trustCreated = settledVolumeUsd * successRate * timeWeight;
  const trustDestroyed =
    failedVolumeUsd +
    lateDeliveryPenalties +
    disputesLost * 500 +
    slashingEvents * 1_000 +
    fraudFlags * 5_000;

  return {
    protocol: 'AXP',
    version: PROOF_OF_TRUST_VERSION,
    agent_id: agent.agent_id,
    agent_name: agent.name,
    status: 'experimental',
    online: Boolean(agent.online),
    heartbeat: agent.heartbeat
      ? {
          available: agent.heartbeat.available,
          current_load: agent.heartbeat.current_load,
          endpoint: agent.heartbeat.endpoint,
          last_seen_at: agent.heartbeat.last_seen_at,
          expires_at: agent.heartbeat.expires_at,
        }
      : null,
    proof_of_trust_score: round(trustCreated - trustDestroyed),
    trust_created: round(trustCreated),
    trust_destroyed: round(trustDestroyed),
    settled_volume_usd: round(settledVolumeUsd),
    stake_usd: round(numeric(agent.collateral_usd, 0)),
    capacity_free: round(numeric(agent.available_capacity, 0)),
    contracts_completed: round(numeric(agent.completed_contracts, 0)),
    success_rate: round(successRate),
    counterparty_diversity: round(counterpartyDiversity),
    time_weight: round(timeWeight),
    failed_volume_usd: round(failedVolumeUsd),
    disputes_lost: round(disputesLost),
    late_delivery_penalties: round(lateDeliveryPenalties),
    slashing_events: round(slashingEvents),
    fraud_flags: round(fraudFlags),
    formula: 'Proof of Trust Score = Trust Created - Trust Destroyed',
    trust_created_formula: 'settled_volume_usd * success_rate * time_weight',
    trust_destroyed_formula:
      'failed_volume_usd + late_delivery_penalties + disputes_lost*500 + slashing_events*1000 + fraud_flags*5000',
    anti_abuse_signals: [
      'counterparty_diversity',
      'disputes_lost',
      'slashing_events',
      'fraud_flags',
    ],
  };
}

function classifyRisk(score, capacity, disputeRate) {
  if (!score.online || capacity <= 0 || score.fraud_flags > 0 || score.slashing_events > 0) {
    return 'HIGH';
  }

  if (score.proof_of_trust_score >= 10_000 && score.success_rate >= 0.95 && disputeRate <= 0.02) {
    return 'LOW';
  }

  if (score.proof_of_trust_score >= 1_000 && score.success_rate >= 0.8 && disputeRate <= 0.1) {
    return 'MEDIUM';
  }

  return 'HIGH';
}

function riskLimitMultiplier(risk) {
  if (risk === 'LOW') {
    return 5;
  }

  if (risk === 'MEDIUM') {
    return 1;
  }

  return 0.1;
}

function confidenceFromScore(score, agent) {
  const base = Math.min(98, Math.max(20, 50 + score.success_rate * 30 + Math.log10(Math.max(1, score.settled_volume_usd)) * 6));
  const onlinePenalty = score.online ? 0 : 20;
  const historyPenalty = numeric(agent.completed_contracts, 0) > 0 ? 0 : 15;
  return round(Math.max(0, base - onlinePenalty - historyPenalty));
}

function fallbackSuccessRate(agent) {
  const completed = numeric(agent.completed_contracts, 0);
  const failed = numeric(agent.failed_contracts, 0);
  const total = completed + failed;
  return total > 0 ? completed / total : 0;
}

function fallbackFailedVolume(agent) {
  return numeric(agent.failed_contracts, 0) * numeric(agent.collateral_usd, 0);
}

function numeric(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function round(value) {
  return Number(value.toFixed(6));
}
