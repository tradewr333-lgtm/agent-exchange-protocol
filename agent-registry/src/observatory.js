// AXP Economic Observatory — "where is the money" intelligence over the AXP ledger.
//
// This is the proprietary, defensible dataset: the real flow of work between agents
// (intents posted, contracts settled, agents available), not GitHub stars. It tells
// agents where demand is, what pays, and which niches are underserved — turning AXP
// into a place agents check daily to find their next dollar, not just a trust score.
// Pure: takes plain arrays so it is deterministically testable.

import { aggregateExternalSignals } from './external-signals.js';
import { AGENT_TEMPLATES } from './agent-templates.js';

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// service category -> launchable template id (so an opportunity becomes one click).
const SERVICE_TO_TEMPLATE = AGENT_TEMPLATES.reduce((m, t) => { m[t.service] = t.id; return m; }, {});

function inWindow(createdAt, from, to) {
  const t = Date.parse(createdAt ?? '');
  return Number.isFinite(t) && t >= from && t < to;
}

export function buildObservatory({ agents = [], intents = [], contracts = [], externalSignals = [] } = {}) {
  const now = Date.now();
  const recentFrom = now - WINDOW_MS;
  const priorFrom = now - 2 * WINDOW_MS;
  const cats = new Map();
  const cat = (name) => {
    const key = name || 'general';
    if (!cats.has(key)) {
      cats.set(key, {
        category: key,
        open_intents: 0, total_intents: 0, open_reward_usd: 0,
        active_agents: 0, settled_contracts: 0, settled_volume_usd: 0,
        intents_recent: 0, intents_prior: 0,
      });
    }
    return cats.get(key);
  };

  const skillCount = new Map();
  for (const intent of intents) {
    const c = cat(intent.service);
    c.total_intents += 1;
    if (intent.status === 'open') {
      c.open_intents += 1;
      c.open_reward_usd += Number(intent.reward_usd) || 0;
    }
    if (inWindow(intent.created_at, recentFrom, now)) c.intents_recent += 1;
    if (inWindow(intent.created_at, priorFrom, recentFrom)) c.intents_prior += 1;
    for (const s of [intent.service, ...(Array.isArray(intent.skills) ? intent.skills : [])]) {
      if (s) skillCount.set(s, (skillCount.get(s) || 0) + 1);
    }
  }

  for (const agent of agents) {
    if (agent.status !== 'active') continue;
    for (const s of Array.isArray(agent.services) ? agent.services : []) cat(s).active_agents += 1;
  }

  for (const contract of contracts) {
    if (contract.status !== 'settled') continue;
    const service = contract.quote?.service ?? contract.terms?.service;
    const value = Number(contract.quote?.requested_capacity ?? contract.terms?.requested_capacity) || 0;
    const c = cat(service);
    c.settled_contracts += 1;
    c.settled_volume_usd += value;
  }

  // External demand signals (GitHub/HuggingFace/MCP registries/marketplaces).
  // Categories that exist ONLY externally still get a bucket — that is the most
  // valuable signal of all: demand forming out there with zero AXP supply yet.
  const external = aggregateExternalSignals(externalSignals, now);
  for (const name of external.keys()) cat(name);

  const categories = [...cats.values()].map((c) => {
    const ext = external.get(c.category) || { external_demand_index: 0, external_growth_pct: 0, external_sources: [] };
    const internalGrowth = c.intents_prior > 0
      ? (c.intents_recent - c.intents_prior) / c.intents_prior
      : (c.intents_recent > 0 ? 1 : 0);
    const externalGrowth = (ext.external_growth_pct || 0) / 100;
    const blendedGrowth = Math.max(internalGrowth, externalGrowth);

    const internalDemand = c.open_reward_usd + c.open_intents * 50;
    const externalDemand = ext.external_demand_index * 100; // USD-proxy weight for off-ledger demand
    const demand = internalDemand + externalDemand;
    const growthFactor = 1 + Math.max(-0.9, Math.min(3, blendedGrowth));
    // High when well-paid (internal + external) demand is growing and underserved by agents.
    const opportunityScore = (demand * growthFactor) / (c.active_agents + 1);

    const hasDemand = c.open_intents > 0 || ext.external_demand_index > 0;
    const demandUnits = Number(ext.external_demand_units || 0);
    // Opportunity Gap: real demand (external units + open intents) minus AXP supply.
    const opportunityGap = Math.max(0, Math.round(demandUnits + c.open_intents - c.active_agents));
    const templateId = SERVICE_TO_TEMPLATE[c.category] || null;
    return {
      ...c,
      open_reward_usd: Number(c.open_reward_usd.toFixed(2)),
      settled_volume_usd: Number(c.settled_volume_usd.toFixed(2)),
      growth_pct: Number((internalGrowth * 100).toFixed(1)),
      external_demand_index: ext.external_demand_index,
      external_demand_units: demandUnits,
      external_growth_pct: ext.external_growth_pct,
      external_sources: ext.external_sources,
      external_only: c.total_intents === 0 && ext.external_demand_index > 0,
      demand_supply_ratio: Number((c.open_intents / (c.active_agents + 1)).toFixed(2)),
      opportunity_gap: opportunityGap,
      template_id: templateId,
      launchable: Boolean(templateId),
      underserved: hasDemand && c.open_intents >= c.active_agents,
      opportunity_score: Number(opportunityScore.toFixed(2)),
    };
  }).sort((a, b) => b.opportunity_score - a.opportunity_score);

  // Launch opportunities: underserved/high-gap categories that map to a launchable
  // template — these power the "Launch X Agent — $49" one-click CTAs.
  const launchOpportunities = categories
    .filter((c) => c.launchable && (c.opportunity_gap > 0 || c.underserved))
    .slice(0, 8)
    .map((c) => ({
      category: c.category,
      template_id: c.template_id,
      opportunity_gap: c.opportunity_gap,
      opportunity_score: c.opportunity_score,
      demand_units: c.external_demand_units,
      open_intents: c.open_intents,
      active_agents: c.active_agents,
      growth_pct: Math.max(c.growth_pct, c.external_growth_pct),
      external_sources: c.external_sources,
    }));

  const topSkills = [...skillCount.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([skill, count]) => ({ skill, requests: count }));

  const topOpportunities = intents
    .filter((i) => i.status === 'open')
    .map((i) => ({
      intent_id: i.intent_id, title: i.title, service: i.service,
      reward_usd: Number(i.reward_usd) || 0, urgency: i.urgency,
    }))
    .sort((a, b) => b.reward_usd - a.reward_usd).slice(0, 10);

  return {
    protocol: 'AXP',
    schema: 'axp.economic_observatory.v0',
    generated_at: new Date().toISOString(),
    note: 'Economic intelligence over the AXP work ledger: where demand is, what pays, and which niches are underserved.',
    window_days: 7,
    totals: {
      categories: categories.length,
      open_intents: categories.reduce((s, c) => s + c.open_intents, 0),
      open_reward_usd: Number(categories.reduce((s, c) => s + c.open_reward_usd, 0).toFixed(2)),
      settled_volume_usd: Number(categories.reduce((s, c) => s + c.settled_volume_usd, 0).toFixed(2)),
      active_agents: agents.filter((a) => a.status === 'active').length,
      external_signal_categories: external.size,
      external_only_categories: categories.filter((c) => c.external_only).length,
    },
    categories,
    launch_opportunities: launchOpportunities,
    top_skills_in_demand: topSkills,
    highest_revenue_opportunities: topOpportunities,
  };
}
