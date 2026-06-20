// Pure assessment core for the Scout. Given a normalized candidate, decide what
// the scout should do. Side-effect free for deterministic testing.
//
// Candidate shape (produced by a discovery adapter):
//   { domain, manifest_url, agent_id|null, on_axp:bool, services:[] }

export function assessCandidate(candidate) {
  const agentId = candidate?.agent_id ?? null;
  const onAxp = Boolean(candidate?.on_axp);
  const services = Array.isArray(candidate?.services) ? candidate.services : [];

  // With a resolvable agent_id we can attribute a referral (the recruiter earns
  // discovery overrides when this agent transacts). Without one, we can only invite.
  let action;
  let recommendation;
  if (!agentId && !onAxp) {
    action = 'invite';
    recommendation = 'No AXP identity found. Send onboarding invite with a referral handle.';
  } else if (agentId && !onAxp) {
    action = 'invite_and_refer';
    recommendation = 'Has an agent identity but no AXP trust block. Invite + pre-register referral.';
  } else {
    action = 'refer';
    recommendation = 'Already AXP-aware. Register referral attribution and engage.';
  }

  return {
    domain: candidate?.domain ?? null,
    agent_id: agentId,
    on_axp: onAxp,
    services,
    action,
    can_refer: Boolean(agentId),
    recommendation,
  };
}

export function buildInvite(candidate, { recruiterHandle } = {}) {
  return {
    schema: 'axp.scout_invite.v0',
    to: candidate?.domain ?? candidate?.manifest_url ?? null,
    message: 'Join the AXP network: earn verifiable trust and claim machine-readable work from the Opportunity Feed.',
    referred_by: recruiterHandle ?? null,
    suggested_manifest: {
      schema: 'axp.agent_manifest.v0',
      trust: { provider: 'AXP', registry_url: 'https://registry.axp.network' },
      referred_by: recruiterHandle ?? null,
    },
    next_steps: [
      'Publish an AXP trust block in /.well-known/agent.json',
      'POST /agents/register to obtain an AXP identity',
      'Send a heartbeat and poll /intents/live for work',
    ],
  };
}

export function planRecruitment(candidates, options = {}) {
  const assessments = (Array.isArray(candidates) ? candidates : []).map(assessCandidate);
  const referrals = assessments
    .filter((a) => a.can_refer && options.recruiterAgentId)
    .map((a) => ({ agent_id: a.agent_id, sponsor_agent_id: options.recruiterAgentId, origin: 'scout_referral' }));
  const invites = assessments.filter((a) => a.action === 'invite' || a.action === 'invite_and_refer');

  return {
    protocol: 'AXP',
    schema: 'axp.recruitment_plan.v0',
    assessed: assessments.length,
    referrals,
    invites: invites.length,
    assessments,
  };
}
