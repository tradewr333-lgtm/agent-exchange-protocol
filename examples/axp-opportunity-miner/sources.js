// Work-source adapters. Each returns an array of raw work items shaped as:
//   { id, title, body, labels: [], reward_usd?, url, source }
// The normalizer turns these into AXP intents.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function loadSampleSource(path) {
  const file = path ?? fileURLToPath(new URL('./sample-work.json', import.meta.url));
  const parsed = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  const items = Array.isArray(parsed) ? parsed : parsed.items ?? [];
  return items.map((item) => ({ ...item, source: item.source ?? 'sample' }));
}

// Public GitHub issues -> work items. No auth (subject to GitHub's low anon rate
// limit). Labels are comma-separated. Returns [] on any failure so the miner
// degrades gracefully instead of crashing.
export async function githubIssuesSource({ repo, labels = '', fetchImpl } = {}) {
  if (!repo) {
    return [];
  }
  const doFetch = fetchImpl ?? globalThis.fetch;
  const url = new URL(`https://api.github.com/repos/${repo}/issues`);
  url.searchParams.set('state', 'open');
  url.searchParams.set('per_page', '30');
  if (labels) {
    url.searchParams.set('labels', labels);
  }

  try {
    const response = await doFetch(url.toString(), {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'axp-opportunity-miner' },
    });
    if (!response.ok) {
      return [];
    }
    const issues = await response.json();
    return (Array.isArray(issues) ? issues : [])
      .filter((issue) => !issue.pull_request) // skip PRs
      .map((issue) => ({
        id: `github:${repo}#${issue.number}`,
        title: issue.title,
        body: issue.body ?? '',
        labels: (issue.labels ?? []).map((label) => (typeof label === 'string' ? label : label.name)),
        url: issue.html_url,
        source: 'github',
      }));
  } catch {
    return [];
  }
}

export async function gatherWorkItems(options = {}) {
  const source = options.source ?? 'sample';
  if (source === 'github') {
    return githubIssuesSource({ repo: options.repo, labels: options.labels, fetchImpl: options.fetchImpl });
  }
  return loadSampleSource(options.path);
}
