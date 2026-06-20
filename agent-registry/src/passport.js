import { getAgent } from './registry.js';
import { getAgentRiskReport, getAgentTrustScore } from './trust-score.js';

export const PASSPORT_VERSION = '0.1.0';

export async function getAgentPassport(agentId) {
  const agent = await getAgent(agentId);
  if (!agent) {
    return null;
  }

  const trustScore = await getAgentTrustScore(agentId);
  const riskReport = await getAgentRiskReport(agentId);

  return {
    protocol: 'AXP',
    version: PASSPORT_VERSION,
    schema: 'axp.agent_passport.v0',
    status: 'experimental',
    agent_id: agent.agent_id,
    passport_uri: `axp://${agent.agent_id}`,
    agent_name: agent.name,
    operator: agent.operator,
    verified: true,
    trust: {
      provider: 'AXP',
      score: trustScore?.proof_of_trust_score ?? 0,
      risk: riskReport?.risk ?? 'UNKNOWN',
      confidence: riskReport?.confidence ?? 0,
      recommended_limit_usd: riskReport?.recommended_limit_usd ?? 0,
      online: Boolean(trustScore?.online),
      capacity_free: trustScore?.capacity_free ?? agent.available_capacity ?? 0,
      stake_usd: trustScore?.stake_usd ?? agent.collateral_usd ?? 0,
      settled_volume_usd: trustScore?.settled_volume_usd ?? 0,
      success_rate: trustScore?.success_rate ?? 0,
      insurance: riskReport?.insurance ?? false,
    },
    services: agent.services ?? [],
    manifest_url: agent.manifest_url ?? null,
    endpoint: agent.heartbeat?.endpoint ?? null,
    headers: {
      'X-AXP-Passport': `axp://${agent.agent_id}`,
      'X-AXP-Trust': String(trustScore?.proof_of_trust_score ?? 0),
      'X-AXP-Risk': riskReport?.risk ?? 'UNKNOWN',
    },
    warning: 'AXP Passport is a trust signal, not a guarantee of future performance.',
  };
}

export async function performAxpHandshake(input = {}) {
  const counterpartyId = input.counterparty_agent_id ?? input.agent_id ?? input.provider_agent_id;
  if (!counterpartyId) {
    return {
      ok: false,
      status: 400,
      error: 'counterparty_agent_id_required',
    };
  }

  const passport = await getAgentPassport(counterpartyId);
  if (!passport) {
    return buildUnknownHandshake(input, counterpartyId);
  }

  const policy = normalizePolicy(input.policy ?? input.trust_policy ?? {});
  const evaluation = evaluatePolicy(passport, policy);

  return {
    ok: true,
    protocol: 'AXP',
    version: PASSPORT_VERSION,
    schema: 'axp.handshake.v0',
    status: 'experimental',
    requester_agent_id: input.requester_agent_id ?? null,
    counterparty_agent_id: counterpartyId,
    handshake: evaluation.accepted ? 'ACCEPTED' : 'REJECTED',
    verified: evaluation.accepted,
    trust_state: evaluation.accepted ? 'TRUST_VERIFIED' : 'TRUST_POLICY_REJECTED',
    policy,
    reasons: evaluation.reasons,
    passport,
    response_headers: {
      ...passport.headers,
      'X-AXP-Handshake': evaluation.accepted ? 'accepted' : 'rejected',
    },
    next_step: evaluation.accepted
      ? 'Counterparty passed AXP trust policy. Contract preparation may continue.'
      : 'Counterparty failed AXP trust policy. Do not prepare a contract unless policy is explicitly overridden.',
  };
}

function buildUnknownHandshake(input, counterpartyId) {
  return {
    ok: true,
    protocol: 'AXP',
    version: PASSPORT_VERSION,
    schema: 'axp.handshake.v0',
    status: 'experimental',
    requester_agent_id: input.requester_agent_id ?? null,
    counterparty_agent_id: counterpartyId,
    handshake: 'REJECTED',
    verified: false,
    trust_state: 'TRUST_UNKNOWN',
    policy: normalizePolicy(input.policy ?? input.trust_policy ?? {}),
    reasons: ['counterparty_has_no_axp_passport'],
    passport: {
      agent_id: counterpartyId,
      passport_uri: `axp://${counterpartyId}`,
      verified: false,
      trust: {
        provider: 'AXP',
        score: 0,
        risk: 'UNKNOWN',
      },
    },
    response_headers: {
      'X-AXP-Passport': `axp://${counterpartyId}`,
      'X-AXP-Trust': 'unknown',
      'X-AXP-Risk': 'UNKNOWN',
      'X-AXP-Handshake': 'rejected',
    },
    next_step: 'Ask the counterparty to register an AXP Passport before economic interaction.',
  };
}

function normalizePolicy(policy) {
  const allowedRisk = Array.isArray(policy.allowed_risk)
    ? policy.allowed_risk
    : ['LOW', 'MEDIUM'];

  return {
    minimum_score: normalizeNumber(policy.minimum_score, 0),
    minimum_stake_usd: normalizeNumber(policy.minimum_stake_usd, 0),
    minimum_capacity_usd: normalizeNumber(policy.minimum_capacity_usd, 0),
    require_online: policy.require_online === undefined ? true : Boolean(policy.require_online),
    insurance_required: Boolean(policy.insurance_required),
    allowed_risk: allowedRisk.map((item) => String(item).toUpperCase()),
  };
}

function evaluatePolicy(passport, policy) {
  const reasons = [];
  const trust = passport.trust ?? {};

  if (Number(trust.score ?? 0) < policy.minimum_score) {
    reasons.push(`trust_score_below_${policy.minimum_score}`);
  }

  if (Number(trust.stake_usd ?? 0) < policy.minimum_stake_usd) {
    reasons.push(`stake_below_${policy.minimum_stake_usd}`);
  }

  if (Number(trust.capacity_free ?? 0) < policy.minimum_capacity_usd) {
    reasons.push(`capacity_below_${policy.minimum_capacity_usd}`);
  }

  if (policy.require_online && !trust.online) {
    reasons.push('agent_offline');
  }

  if (policy.insurance_required && !trust.insurance) {
    reasons.push('insurance_missing');
  }

  if (!policy.allowed_risk.includes(String(trust.risk ?? 'UNKNOWN').toUpperCase())) {
    reasons.push(`risk_not_allowed_${trust.risk ?? 'UNKNOWN'}`);
  }

  return {
    accepted: reasons.length === 0,
    reasons: reasons.length === 0 ? ['policy_passed'] : reasons,
  };
}

function normalizeNumber(value, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }

  return number;
}
