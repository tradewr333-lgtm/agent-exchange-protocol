// Sybil-resistant trust weighting (TraceRank-style).
//
// Naive reputation is gameable: spinning up N free agents that "settle" with each
// other inflates settled volume → trust. The fix is to weight every settlement by
// the STAKE-backed reputation of the counterparty who paid, decayed by time. A ring
// of zero-stake agents paying each other propagates ~zero trust, because each
// counterparty's weight is ~0. Stake (collateral) is the Sybil cost anchor.

export const STAKE_ANCHOR_USD = 1000;
export const RECENCY_HALF_LIFE_DAYS = 30;

// Stake-saturating reputation weight in [0,1]. ~0 at zero stake, ~0.63 at the
// anchor, ~0.86 at 2x. Slashed / fraud-flagged agents are forced to 0.
export function reputationWeight(agent) {
  if (!agent) return 0;
  const fraud = Number(agent.trust_metrics?.fraud_flags ?? 0);
  const slashing = Number(agent.trust_metrics?.slashing_events ?? 0);
  if (agent.status === 'slashed' || fraud > 0 || slashing > 0) return 0;
  const stake = Number(agent.collateral_usd ?? agent.collateral?.total_usd ?? 0);
  if (!(stake > 0)) return 0;
  return Number((1 - Math.exp(-stake / STAKE_ANCHOR_USD)).toFixed(4));
}

export function recencyDecay(createdAt, halfLifeDays = RECENCY_HALF_LIFE_DAYS) {
  const t = Date.parse(createdAt ?? '');
  if (!Number.isFinite(t)) return 1;
  const ageDays = Math.max(0, (Date.now() - t) / 86_400_000);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

// Reputation-weighted settled volume for one provider, from settlement events.
// value × counterpartyWeight × recency. Self-deals (provider == counterparty)
// and unknown counterparties contribute nothing meaningful.
export function weightedSettledVolume(providerId, events, weightById) {
  let total = 0;
  for (const event of events ?? []) {
    if (event.event_type !== 'contract_settled') continue;
    if (event.agent_id !== providerId) continue;
    const counterparty = event.counterparty_id;
    if (!counterparty || counterparty === providerId) continue;
    const w = weightById.get(counterparty) ?? 0;
    if (w <= 0) continue;
    total += (Number(event.value_usd) || 0) * w * recencyDecay(event.created_at);
  }
  return total;
}

// Compute Sybil-resistant scores across a set of agents using the trust-event
// ledger. weightById is seeded from stake, then refined once using settled-volume
// reputation (a light TraceRank iteration) so trust flows from genuinely reputable
// payers, not from cheap identities.
export function computeWeightedScores(agents, events) {
  const byId = new Map(agents.map((a) => [a.agent_id, a]));
  const stakeWeight = new Map(agents.map((a) => [a.agent_id, reputationWeight(a)]));

  // Iteration 1: weighted volume using stake weights.
  const vol1 = new Map();
  for (const a of agents) vol1.set(a.agent_id, weightedSettledVolume(a.agent_id, events, stakeWeight));
  const maxVol1 = Math.max(1, ...vol1.values());

  // Refined weight = blend of stake and normalized reputation-weighted volume.
  const refined = new Map();
  for (const a of agents) {
    const blended = 0.6 * (stakeWeight.get(a.agent_id) ?? 0) + 0.4 * ((vol1.get(a.agent_id) ?? 0) / maxVol1);
    refined.set(a.agent_id, Math.min(1, blended));
  }

  // Iteration 2: final weighted volume using refined counterparty weights.
  const result = new Map();
  for (const a of agents) {
    const weighted = weightedSettledVolume(a.agent_id, events, refined);
    const rawDestroyed = Number(a.trust_metrics?.failed_volume_usd ?? 0)
      + Number(a.trust_metrics?.disputes_lost ?? 0) * 500
      + Number(a.trust_metrics?.slashing_events ?? 0) * 1000
      + Number(a.trust_metrics?.fraud_flags ?? 0) * 5000;
    result.set(a.agent_id, {
      agent_id: a.agent_id,
      reputation_weight: Number((refined.get(a.agent_id) ?? 0).toFixed(4)),
      weighted_settled_volume_usd: Number(weighted.toFixed(2)),
      sybil_resistant_score: Number((weighted - rawDestroyed).toFixed(2)),
    });
  }
  return result;
}
