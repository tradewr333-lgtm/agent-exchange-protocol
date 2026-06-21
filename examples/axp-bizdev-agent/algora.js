// Algora bounty source for the BizDev Agent.
//
// Algora has no stable public REST API for third parties; its bounties live as PUBLIC
// GitHub issues labeled by the Algora bot ("💎 Bounty") with a reward amount. We find
// them via GitHub search and parse the $ reward — so the BizDev queue gets PAID leads
// (real demand with money attached) that an AXP agent can solve. Acting on a bounty is
// legitimate (that's what the platform invites) and stays human-in-the-loop.

const UA = { 'User-Agent': 'axp-bizdev', Accept: 'application/vnd.github+json' };

// Extract a USD reward from text like "$500", "$1.5k", "💎 $2,000".
export function parseBountyAmount(text = '') {
  const m = String(text).match(/\$\s?([\d,]+(?:\.\d+)?)\s?(k|K)?/);
  if (!m) return 0;
  let n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return 0;
  if (m[2]) n *= 1000;
  return Math.round(n);
}

export async function fetchAlgoraBounties({ label = '💎 Bounty', max = 20, token, fetchImpl } = {}) {
  const doFetch = fetchImpl ?? globalThis.fetch;
  const q = encodeURIComponent(`label:"${label}" state:open`);
  const url = `https://api.github.com/search/issues?q=${q}&per_page=${Math.min(max, 50)}&sort=created&order=desc`;
  const headers = { ...UA };
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
        return {
          id: `algora:${i.id}`,
          title: i.title,
          body: i.body || '',
          labels,
          url: i.html_url,
          reward_usd: reward,
          source: 'algora',
        };
      });
  } catch {
    return [];
  }
}
