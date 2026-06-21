// AXP Venture Studio — the Observatory publishes Opportunity Intents.
//
// The protocol does NOT execute the work itself (it never competes with its users).
// Instead, when the Observatory detects an underserved, well-paid, growing category,
// it publishes a machine-readable Opportunity Intent. Network agents compete to claim
// and fulfill it; AXP earns on the resulting reputation + settlement flow.
//
// planObservatoryOpportunities is pure (returns intent bodies, writes nothing) so it
// is deterministically testable; publishObservatoryOpportunities performs the writes.

import { publishIntent } from './intents.js';

export const OBSERVATORY_REQUESTER = 'axp_protocol';
export const OBSERVATORY_SOURCE = 'axp_observatory';

export function planObservatoryOpportunities({
  observatory,
  existingIntents = [],
  max = 3,
  minScore = 100,
} = {}) {
  if (!observatory || !Array.isArray(observatory.categories)) return [];

  // Idempotency: don't re-post a category that already has a live observatory opportunity.
  const liveObsCategories = new Set(
    existingIntents
      .filter((i) => i && i.status === 'open' && i.source === OBSERVATORY_SOURCE && i.service)
      .map((i) => i.service),
  );

  const picks = [];
  for (const c of observatory.categories) {
    if (picks.length >= max) break;
    if (!c.underserved) continue;
    if (Number(c.opportunity_score) < minScore) continue;
    if (liveObsCategories.has(c.category)) continue;

    const reward = pickReward(c);
    const sources = Array.isArray(c.external_sources) ? c.external_sources : [];
    const evidence = sources.length
      ? ` External demand observed via ${sources.join(', ')}.`
      : '';
    picks.push({
      title: `High-demand opportunity: ${humanize(c.category)}`,
      description:
        `AXP Observatory detected underserved demand in "${c.category}" ` +
        `(opportunity score ${c.opportunity_score}, growth ${c.growth_pct}%, ${c.active_agents} active agents).` +
        `${evidence} Open work for capable agents — claim it, deliver, settle, and earn reputation.`,
      service: c.category,
      skills: [c.category],
      reward_usd: reward,
      urgency: Number(c.opportunity_score) > minScore * 4 ? 'HIGH' : 'MEDIUM',
      required_capacity_usd: Math.round(reward * 0.5),
      source: OBSERVATORY_SOURCE,
      requester: OBSERVATORY_REQUESTER,
      metadata: {
        observatory: true,
        opportunity_score: c.opportunity_score,
        growth_pct: c.growth_pct,
        external_demand_index: c.external_demand_index ?? 0,
        external_sources: sources,
      },
    });
  }
  return picks;
}

export async function publishObservatoryOpportunities(args = {}) {
  const plans = planObservatoryOpportunities(args);
  const created = [];
  for (const body of plans) {
    const res = await publishIntent(body);
    if (res.ok) created.push(res.intent);
  }
  return created;
}

function pickReward(c) {
  const avgOpen = c.open_intents > 0 ? Number(c.open_reward_usd) / c.open_intents : 0;
  return Math.round(Math.max(avgOpen, 250));
}

function humanize(s) {
  return String(s).replace(/[_-]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}
