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

// GitHub repositories matching a query, plus an optional growth proxy: the share of
// matching repos created in the last 90 days (a rough "is this niche heating up?").
//
// Pass a token to authenticate (Search API: 30 req/min vs 10 req/min unauthenticated)
// — that also unlocks the second (growth) request without tripping the rate limit.
export async function githubSignal(category, query, { token, withGrowth = true } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const q = encodeURIComponent(query);
  const total = await getJson(`https://api.github.com/search/repositories?q=${q}&per_page=1`, headers);
  const value = Number(total.total_count) || 0;

  let growthPct = 0;
  if (withGrowth) {
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
    const recent = await getJson(
      `https://api.github.com/search/repositories?q=${q}+created:>=${since}&per_page=1`,
      headers,
    );
    const recentCount = Number(recent.total_count) || 0;
    // Annualized-ish growth proxy: recent 90d share extrapolated vs the rest.
    const baseline = Math.max(1, value - recentCount);
    const g = ((recentCount * 4) / baseline) * 100;
    growthPct = Number.isFinite(g) ? Number(Math.min(g, 500).toFixed(1)) : 0;
  }

  return {
    source: 'github',
    category,
    metric: 'repositories',
    value,
    growth_pct: growthPct,
    query,
    observed_at: new Date().toISOString(),
  };
}

// npm package ecosystem activity for a query — public registry, no key, generous limits.
export async function npmSignal(category, query) {
  if (!query) return null;
  const data = await getJson(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=1`);
  const value = Number(data.total) || 0;
  return {
    source: 'npm',
    category,
    metric: 'packages',
    value,
    growth_pct: 0,
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
