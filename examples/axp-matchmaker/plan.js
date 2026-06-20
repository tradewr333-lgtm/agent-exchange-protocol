// Pure planning core for the Matchmaker. Given an Opportunity Graph, decide:
//   - introductions: notify the best-fit idle agent of a matching intent
//   - sponsorships: for intents no agent can fill, pick a sponsor and mint a scion
// Side-effect free so it can be unit tested without a network.

const DEFAULT_COMMITTED_CAPACITY = 1000;

export function planMatchmaking(graph, options = {}) {
  const maxIntroductions = numberOr(options.maxIntroductions, 25);
  const maxSponsors = numberOr(options.maxSponsors, 5);

  const suggested = Array.isArray(graph?.suggested_matches) ? graph.suggested_matches : [];
  const spawn = Array.isArray(graph?.spawn_opportunities) ? graph.spawn_opportunities : [];
  const idle = Array.isArray(graph?.idle_agents) ? graph.idle_agents : [];

  const introductions = suggested
    .filter((match) => match.best_agent?.agent_id)
    .slice(0, maxIntroductions)
    .map((match) => ({
      agent_id: match.best_agent.agent_id,
      intent_id: match.intent_id,
      service: match.service,
      match_score: match.best_agent.match_score,
      reward_usd: match.reward_usd,
    }));

  // Choose a sponsor: explicit override, else the highest-trust idle agent able to commit.
  const sponsor = resolveSponsor(idle, options.sponsorAgentId);

  const sponsorships = sponsor
    ? spawn.slice(0, maxSponsors).map((intent) => ({
        sponsor_agent_id: sponsor.agent_id,
        service: intent.service,
        intent_id: intent.intent_id,
        committed_capacity_usd: Math.max(
          Number(intent.required_capacity_usd) || 0,
          DEFAULT_COMMITTED_CAPACITY,
        ),
        reward_usd: intent.reward_usd,
      }))
    : [];

  return {
    protocol: 'AXP',
    schema: 'axp.matchmaking_plan.v0',
    sponsor_agent_id: sponsor?.agent_id ?? null,
    introductions,
    sponsorships,
    skipped_sponsorships: sponsor ? Math.max(0, spawn.length - maxSponsors) : spawn.length,
  };
}

function resolveSponsor(idleAgents, sponsorAgentId) {
  if (sponsorAgentId) {
    const explicit = idleAgents.find((agent) => agent.agent_id === sponsorAgentId);
    return explicit ?? { agent_id: sponsorAgentId };
  }
  const candidates = idleAgents
    .filter((agent) => (Number(agent.available_capacity_usd) || 0) > 0)
    .sort((a, b) => (Number(b.trust_score) || 0) - (Number(a.trust_score) || 0));
  return candidates[0] ?? null;
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
