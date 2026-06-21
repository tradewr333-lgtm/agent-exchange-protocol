// Algora PAID-bounty source for the BizDev Agent.
//
// PRIMARY: Algora's public REST API — GET https://console.algora.io/api/orgs/{org}/bounties
// (no auth). It returns the EXACT reward (amount is in cents), status, and the GitHub issue.
// This is deterministic and far more reliable than scraping labels. It is org-scoped, so we
// iterate a curated, configurable list of orgs known to run bounty programs.
//
// FALLBACK: the legacy global GitHub search for the Algora bot label ("💎 Bounty"), which
// catches bounties from orgs not in our list. Results are merged + deduped by issue URL.
//
// Acting on a bounty is legitimate (that's the platform's purpose) and stays human-in-the-loop:
// AXP surfaces + drafts; the owner submits the PR and claims the reward on Algora.

const UA = { 'User-Agent': 'axp-bizdev', Accept: 'application/json' };

// Best-effort default orgs with active Algora bounty programs. Override via env
// AXP_ALGORA_ORGS="org1,org2,...". (Org slugs are Algora handles, usually = GitHub org.)
// Confirmed-active Algora org slugs (from algora.io/bounties, June 2026). Mostly dev-tool
// / data / infra OSS — i.e. issues that classify as code_review / data_processing / security.
export const DEFAULT_ALGORA_ORGS = [
  'twentyhq', 'keephq', 'triggerdotdev', 'windmill-labs', 'coollabsio', 'highlight',
  'mendableai', 'trieve', 'onyx-dot-app', 'dittofeed', 'panoratech', 'traceloop',
  'moonrepo', 'browser-use', 'outerbase', 'thesysdev', 'archestra-ai', 'capgo', 'isaac',
];

// Repo OWNERS that are agent-testing playgrounds / demo bounties, not real companies
// that actually pay. Filtered out by default; override via AXP_ALGORA_BLOCK_OWNERS.
export const DEFAULT_BLOCK_OWNERS = ['securebananalabs', 'xevrion-v2', 'tine1117'];

// Pull the GitHub repo owner from an issue URL: https://github.com/{owner}/{repo}/...
export function ownerFromUrl(url = '') {
  const m = String(url).match(/github\.com\/([^/]+)\//i);
  return m ? m[1] : null;
}

// Extract a USD reward from free text like "$500", "$1.5k", "💎 $2,000" (used by the
// GitHub-label fallback, where the amount is embedded in text rather than structured).
export function parseBountyAmount(text = '') {
  const m = String(text).match(/\$\s?([\d,]+(?:\.\d+)?)\s?(k|K)?/);
  if (!m) return 0;
  let n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return 0;
  if (m[2]) n *= 1000;
  return Math.round(n);
}

function normalizeApiBounty(b) {
  const issue = b.issue || {};
  const url = issue.html_url || `https://github.com/${b.repo_owner}/${b.repo_name}/issues/${b.number}`;
  return {
    id: `algora:${b.id}`,
    title: issue.title || `${b.repo_owner}/${b.repo_name}#${b.number}`,
    body: issue.body || '',
    labels: [],
    url,
    reward_usd: Math.round((Number(b.amount) || 0) / 100), // amount is in cents
    org: b.repo_owner || null,
    source: 'algora',
  };
}

// Real Algora API for one org. Returns only ACTIVE bounties on OPEN issues.
export async function fetchAlgoraBountiesForOrg(org, { limit = 25, fetchImpl } = {}) {
  const doFetch = fetchImpl ?? globalThis.fetch;
  const url = `https://console.algora.io/api/orgs/${encodeURIComponent(org)}/bounties?limit=${Math.min(Math.max(limit, 1), 100)}`;
  try {
    const res = await doFetch(url, { headers: UA });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || [])
      .filter((b) => b && b.status === 'active' && (!b.issue || b.issue.state !== 'closed'))
      .map(normalizeApiBounty)
      .filter((b) => b.reward_usd > 0);
  } catch {
    return [];
  }
}

// Legacy fallback: global GitHub search for the Algora bot label.
export async function fetchAlgoraBountiesByLabel({ label = '💎 Bounty', max = 20, token, fetchImpl } = {}) {
  const doFetch = fetchImpl ?? globalThis.fetch;
  const q = encodeURIComponent(`label:"${label}" state:open`);
  const url = `https://api.github.com/search/issues?q=${q}&per_page=${Math.min(max, 50)}&sort=created&order=desc`;
  const headers = { 'User-Agent': 'axp-bizdev', Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await doFetch(url, { headers });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || [])
      .filter((i) => !i.pull_request)
      .map((i) => {
        const labels = (i.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
        const reward = parseBountyAmount(`${i.title} ${labels.join(' ')} ${(i.body || '').slice(0, 600)}`);
        return { id: `algora:${i.id}`, title: i.title, body: i.body || '', labels, url: i.html_url, reward_usd: reward, source: 'algora' };
      });
  } catch {
    return [];
  }
}

// Combined: real API across the org list (primary) + label fallback, merged & deduped,
// sorted by reward desc. `orgs` overrides the default list; `token` is for the fallback.
export async function fetchAlgoraBounties({ orgs, max = 30, perOrg = 25, token, fetchImpl, withFallback = true, blockOwners } = {}) {
  const orgList = (orgs && orgs.length) ? orgs : DEFAULT_ALGORA_ORGS;
  const blocked = new Set((blockOwners && blockOwners.length ? blockOwners : DEFAULT_BLOCK_OWNERS).map((o) => String(o).trim().toLowerCase()));
  const isBlocked = (b) => {
    const owner = (b.org || ownerFromUrl(b.url) || '').toLowerCase();
    return owner && blocked.has(owner);
  };
  const seen = new Set();
  const out = [];

  for (const org of orgList) {
    if (out.length >= max) break;
    const items = await fetchAlgoraBountiesForOrg(org, { limit: perOrg, fetchImpl });
    for (const b of items) {
      if (!b.url || seen.has(b.url) || isBlocked(b)) continue;
      seen.add(b.url);
      out.push(b);
    }
  }

  if (withFallback && out.length < max) {
    const fb = await fetchAlgoraBountiesByLabel({ max: max - out.length, token, fetchImpl });
    for (const b of fb) {
      if (!b.url || seen.has(b.url) || isBlocked(b)) continue;
      seen.add(b.url);
      out.push(b);
    }
  }

  return out.sort((a, b) => (b.reward_usd || 0) - (a.reward_usd || 0)).slice(0, max);
}
