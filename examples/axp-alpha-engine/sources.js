// External demand sources for the AXP Alpha Engine.
//
// These hit PUBLIC, unauthenticated endpoints (GitHub search, HuggingFace models)
// so the collector runs anywhere with no API keys. GitHub allows ~10 search
// requests/min unauthenticated; we stay well under that. Network calls run on the
// operator's machine, never in the registry sandbox.

const UA = { 'User-Agent': 'axp-alpha-engine', Accept: 'application/vnd.github+json' };

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { ...UA, ...headers } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

// GitHub repositories matching a query, plus a growth proxy: the share of matching
// repos created in the last 90 days (a rough "is this niche heating up?" signal).
export async function githubSignal(category, query) {
  const q = encodeURIComponent(query);
  const total = await getJson(`https://api.github.com/search/repositories?q=${q}&per_page=1`);
  const value = Number(total.total_count) || 0;

  const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const recent = await getJson(
    `https://api.github.com/search/repositories?q=${q}+created:>=${since}&per_page=1`,
  );
  const recentCount = Number(recent.total_count) || 0;
  // Annualized-ish growth proxy: recent 90d share extrapolated vs the rest.
  const baseline = Math.max(1, value - recentCount);
  const growthPct = Number((((recentCount * 4) / baseline) * 100).toFixed(1));

  return {
    source: 'github',
    category,
    metric: 'repositories',
    value,
    growth_pct: Number.isFinite(growthPct) ? Math.min(growthPct, 500) : 0,
    query,
    observed_at: new Date().toISOString(),
  };
}

// HuggingFace models matching a search term (count of returned models, capped list).
export async function huggingfaceSignal(category, search) {
  if (!search) return null;
  const models = await getJson(
    `https://huggingface.co/api/models?search=${encodeURIComponent(search)}&limit=100`,
  );
  const value = Array.isArray(models) ? models.length : 0;
  return {
    source: 'huggingface',
    category,
    metric: 'models',
    value,
    growth_pct: 0,
    query: search,
    observed_at: new Date().toISOString(),
  };
}
