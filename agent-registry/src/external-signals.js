// AXP Alpha Engine — external demand signals.
//
// Canonical, normalized signals scraped from OUTSIDE the AXP ledger: GitHub,
// HuggingFace, MCP registries, agent marketplaces. They let the Observatory see
// where demand for a category is forming BEFORE it shows up as on-ledger intents,
// so AXP can surface (and auto-publish) the opportunity first.
//
// Pure module: no IO. Collectors run off-box (no sandbox network) and POST signals
// to /observatory/signals; the server stores them and folds them in here.

export const SIGNAL_SCHEMA = 'axp.external_signal.v0';
const HALF_LIFE_DAYS = 14;

// Source credibility weights — a listing in an MCP registry is a stronger signal of
// real agent demand than a raw repo count, etc. Unknown sources get a low default.
const SOURCE_WEIGHT = {
  mcp_registry: 1.1,
  github: 1.0,
  marketplace: 1.0,
  huggingface: 0.9,
  manual: 0.6,
};

export function normalizeSignal(raw = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const category = typeof raw.category === 'string' ? raw.category.trim() : '';
  const source = typeof raw.source === 'string' ? raw.source.trim().toLowerCase() : '';
  if (!category || !source) return null;
  const value = Number(raw.value);
  return {
    schema: SIGNAL_SCHEMA,
    source,
    category,
    metric: typeof raw.metric === 'string' ? raw.metric : 'count',
    value: Number.isFinite(value) && value >= 0 ? value : 0,
    growth_pct: Number.isFinite(Number(raw.growth_pct)) ? Number(raw.growth_pct) : 0,
    query: typeof raw.query === 'string' ? raw.query : null,
    observed_at: raw.observed_at ?? new Date().toISOString(),
  };
}

function recencyWeight(observedAt, now, halfLifeDays = HALF_LIFE_DAYS) {
  const t = Date.parse(observedAt ?? '');
  if (!Number.isFinite(t)) return 0;
  const ageDays = Math.max(0, (now - t) / 86_400_000);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

// Aggregate raw signals into a per-category external demand index.
// Returns a Map<category, { external_demand_index, external_growth_pct, external_sources }>.
export function aggregateExternalSignals(signals = [], now = Date.now()) {
  // Keep only the most recent signal per (source, category, metric) so a collector
  // re-posting the same source on every run does not inflate the index.
  const latest = new Map();
  for (const raw of Array.isArray(signals) ? signals : []) {
    const sig = normalizeSignal(raw);
    if (!sig) continue;
    const key = `${sig.source}|${sig.category}|${sig.metric}`;
    const prev = latest.get(key);
    if (!prev || Date.parse(sig.observed_at) >= Date.parse(prev.observed_at)) latest.set(key, sig);
  }

  const byCat = new Map();
  for (const sig of latest.values()) {
    const w = recencyWeight(sig.observed_at, now) * (SOURCE_WEIGHT[sig.source] ?? 0.5);
    if (w <= 0) continue;
    if (!byCat.has(sig.category)) {
      byCat.set(sig.category, { index: 0, growthNum: 0, growthDen: 0, demandUnits: 0, sources: new Set() });
    }
    const c = byCat.get(sig.category);
    // log-scale so a category with 10k repos doesn't dwarf everything; recency/source weighted.
    const contribution = Math.log10(1 + sig.value) * w;
    c.index += contribution;
    const den = contribution || w;
    c.growthNum += sig.growth_pct * den;
    c.growthDen += den;
    // Raw demand units (e.g. repos/models found) — the human-readable demand side of the gap.
    c.demandUnits += sig.value;
    c.sources.add(sig.source);
  }

  const out = new Map();
  for (const [category, c] of byCat.entries()) {
    out.set(category, {
      category,
      external_demand_index: Number(c.index.toFixed(4)),
      external_demand_units: Math.round(c.demandUnits),
      external_growth_pct: c.growthDen > 0 ? Number((c.growthNum / c.growthDen).toFixed(1)) : 0,
      external_sources: [...c.sources].sort(),
    });
  }
  return out;
}
