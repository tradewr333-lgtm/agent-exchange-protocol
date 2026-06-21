#!/usr/bin/env node
// AXP BizDev / Outreach Agent (human-in-the-loop).
//
// Brings real external demand to AXP agents — without spamming. It pulls real,
// PUBLIC "help wanted" / bounty issues from GitHub, matches each to the best AXP
// agent (or suggests launching one for that niche), and drafts a short, honest
// outreach with a direct hire link. It does NOT post anything: it prints a review
// queue for YOU to approve and send from your own account, where appropriate.
//
// Run on your machine (needs outbound network):
//   AXP_REGISTRY_URL=https://axp.network \
//   AXP_BIZDEV_REPOS="owner/repo,owner/repo" \
//   GITHUB_TOKEN=ghp_xxx \
//   node examples/axp-bizdev-agent/bizdev.js
//
// AXP_BIZDEV_LABELS defaults to "help wanted,good first issue,bounty".

import { githubIssuesSource } from '../axp-opportunity-miner/sources.js';
import { inferService } from '../axp-opportunity-miner/normalize.js';
import { buildLead, prioritize } from './match.js';
import { classifyTask } from './classify.js';
import { fetchAlgoraBounties } from './algora.js';

const WITH_ALGORA = process.env.AXP_BIZDEV_ALGORA !== 'false'; // include paid Algora bounties

const REGISTRY = (process.env.AXP_REGISTRY_URL || 'https://axp.network').replace(/\/$/, '');
const repos = (process.env.AXP_BIZDEV_REPOS || '').split(',').map((r) => r.trim()).filter(Boolean);
const labels = process.env.AXP_BIZDEV_LABELS || 'help wanted,good first issue,bounty';
const MAX = Number(process.env.AXP_BIZDEV_MAX || 15);
const MIN_TRUST = Number(process.env.AXP_BIZDEV_MIN_TRUST ?? 1); // skip trust-0 stubs by default

async function fetchAgents() {
  try {
    const res = await fetch(`${REGISTRY}/store/agents`);
    const data = await res.json();
    return data.agents || [];
  } catch (err) {
    console.warn(`Could not fetch AXP agents: ${err.message}`);
    return [];
  }
}

async function gather() {
  if (repos.length === 0) {
    console.log('No AXP_BIZDEV_REPOS set — skipping GitHub help-wanted demand.');
    console.log('  (Algora paid bounties are still fetched. To add GitHub demand:)');
    console.log('  AXP_BIZDEV_REPOS="langchain-ai/langchain,openai/openai-cookbook" node examples/axp-bizdev-agent/bizdev.js');
  }
  // GitHub treats labels=a,b,c as AND (issue must have ALL). Query one label at a
  // time (OR) and dedupe so we actually find help-wanted/bounty issues.
  const labelList = labels.split(',').map((l) => l.trim()).filter(Boolean);
  const seen = new Set();

  // PAID Algora bounties FIRST — they have money attached, so they get priority for the
  // MAX slots. (Previously GitHub help-wanted filled the cap and truncated the bounties.)
  const bounties = [];
  if (WITH_ALGORA) {
    try {
      const orgs = (process.env.AXP_ALGORA_ORGS || '').split(',').map((o) => o.trim()).filter(Boolean);
      const blockOwners = (process.env.AXP_ALGORA_BLOCK_OWNERS || '').split(',').map((o) => o.trim()).filter(Boolean);
      const found = await fetchAlgoraBounties({ orgs: orgs.length ? orgs : undefined, blockOwners: blockOwners.length ? blockOwners : undefined, token: process.env.GITHUB_TOKEN, max: 30 });
      for (const b of found) {
        if (b.url && seen.has(b.url)) continue;
        if (b.url) seen.add(b.url);
        bounties.push(b);
      }
      if (found.length) console.log(`Found ${found.length} Algora bounty/bounties (paid demand).`);
    } catch (err) { console.warn(`Algora skip: ${err.message}`); }
  }

  // GitHub help-wanted demand (unpaid) fills the remaining slots.
  const ghItems = [];
  for (const repo of repos) {
    let foundForRepo = 0;
    for (const label of labelList) {
      try {
        const found = await githubIssuesSource({ repo, labels: label });
        for (const it of found) {
          if (it.url && seen.has(it.url)) continue;
          if (it.url) seen.add(it.url);
          ghItems.push(it);
          foundForRepo += 1;
        }
      } catch (err) {
        console.warn(`skip ${repo} [${label}]: ${err.message}`);
      }
    }
    // Fallback: if nothing labeled, take a few recent open issues from the repo.
    if (foundForRepo === 0) {
      try {
        const recent = await githubIssuesSource({ repo, labels: '' });
        for (const it of recent.slice(0, 5)) {
          if (it.url && seen.has(it.url)) continue;
          if (it.url) seen.add(it.url);
          ghItems.push(it);
        }
      } catch { /* ignore */ }
    }
  }

  // Paid bounties take priority; GitHub demand fills whatever slots remain.
  return [...bounties, ...ghItems].slice(0, MAX);
}

const [workItems, agents] = await Promise.all([gather(), fetchAgents()]);

// Classify each task with Claude (accurate) when ANTHROPIC_API_KEY is set; else keyword.
// Run in parallel so 15 issues take ~2s, not ~30s — with a timeout so it never hangs.
if (workItems.length) console.log(`Classifying ${workItems.length} task(s)…`);
const rawLeads = await Promise.all(workItems.map(async (item) => {
  let service;
  let summary = '';
  let llmDraft = '';
  const classified = await classifyTask({ title: item.title, body: item.body, reward: item.reward_usd, source: item.source });
  if (classified) { service = classified.service; summary = classified.summary; llmDraft = classified.draft || ''; }
  else { service = inferService(item).service; }
  return buildLead({ item, service, summary, llmDraft, agents, registryUrl: REGISTRY, minTrust: MIN_TRUST });
}));
const leads = prioritize(rawLeads);

console.log(`\n=== AXP BizDev review queue — ${leads.length} lead(s) · HUMAN REVIEW REQUIRED ===`);
console.log('Review each draft and send it yourself, from your own account, only where appropriate.\n');
for (const lead of leads) {
  console.log('────────────────────────────────────────────────────────');
  console.log(`TASK:    ${lead.title}`);
  console.log(`SOURCE:  ${lead.source_uri || '(n/a)'}${lead.source === 'algora' ? '  [ALGORA BOUNTY]' : ''}`);
  console.log(`SERVICE: ${lead.service}`);
  if (lead.reward_usd > 0) console.log(`REWARD:  $${Number(lead.reward_usd).toLocaleString()} 💰`);
  if (lead.matched_agent) {
    console.log(`AGENT:   ${lead.matched_agent.name} (trust ${lead.matched_agent.trust_score}) → ${lead.matched_agent.hire_link}`);
  } else {
    console.log(`AGENT:   none yet — launch a "${lead.suggested_template}" agent: ${REGISTRY}/store`);
  }
  console.log(`DRAFT:\n${lead.draft}\n`);
}

console.log(JSON.stringify({
  protocol: 'AXP',
  schema: 'axp.bizdev_leads.v0',
  mode: 'human_review_required',
  generated_at: new Date().toISOString(),
  count: leads.length,
  leads,
}, null, 2));

// Cloud mode: deliver matched leads to each agent owner's inbox on the server.
if (process.env.AXP_BIZDEV_POST === 'true' && process.env.AXP_SIGNALS_INGEST_KEY) {
  const matched = leads.filter((l) => l.matched_agent);
  try {
    const res = await fetch(`${REGISTRY}/leads/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-axp-ingest-key': process.env.AXP_SIGNALS_INGEST_KEY },
      body: JSON.stringify({ leads: matched }),
    });
    console.log(`\nPOST /leads/ingest -> ${res.status} ${await res.text()}`);
  } catch (err) {
    console.warn(`lead delivery failed: ${err.message}`);
  }
}
