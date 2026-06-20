import { getAgent, listAgents } from './registry.js';

export const PROOF_OF_TRUST_VERSION = '0.1.0';

export function getAgentTrustScore(agentId) {
  const agent = getAgent(agentId);
  if (!agent) {
    return null;
  }

  return calculateAgentTrustScore(agent);
}

export function getTrustRanking(filters = {}) {
  const minScore = filters.minScore === undefined ? undefined : Number(filters.minScore);
  const limit = filters.limit === undefined ? undefined : Number(filters.limit);
  let rankedAgents = listAgents({
    status: filters.status,
    service: filters.service,
  }).agents.map(calculateAgentTrustScore);

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
      min_score: Number.isFinite(minScore) ? minScore : null,
      limit: Number.isFinite(limit) && limit > 0 ? limit : null,
    },
    agents: rankedAgents,
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
    proof_of_trust_score: round(trustCreated - trustDestroyed),
    trust_created: round(trustCreated),
    trust_destroyed: round(trustDestroyed),
    settled_volume_usd: round(settledVolumeUsd),
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
