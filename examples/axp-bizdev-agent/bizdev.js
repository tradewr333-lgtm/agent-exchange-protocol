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
import { matchLeads } from './match.js';

const REGISTRY = (process.env.AXP_REGISTRY_URL || 'https://axp.network').replace(/\/$/, '');
const repos = (process.env.AXP_BIZDEV_REPOS || '').split(',').map((r) => r.trim()).filter(Boolean);
const labels = process.env.AXP_BIZDEV_LABELS || 'help wanted,good first issue,bounty';
const MAX = Number(process.env.AXP_BIZDEV_MAX || 15);

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
    console.log('No AXP_BIZDEV_REPOS set. Example:');
    console.log('  AXP_BIZDEV_REPOS="langchain-ai/langchain,openai/openai-cookbook" node examples/axp-bizdev-agent/bizdev.js');
    return [];
  }
  const items = [];
  for (const repo of repos) {
    try {
      const found = await githubIssuesSource({ repo, labels });
      items.push(...found);
    } catch (err) {
      console.warn(`skip ${repo}: ${err.message}`);
    }
  }
  return items.slice(0, MAX);
}

const [workItems, agents] = await Promise.all([gather(), fetchAgents()]);
const leads = matchLeads({ workItems, agents, registryUrl: REGISTRY });

console.log(`\n=== AXP BizDev review queue — ${leads.length} lead(s) · HUMAN REVIEW REQUIRED ===`);
console.log('Review each draft and send it yourself, from your own account, only where appropriate.\n');
for (const lead of leads) {
  console.log('────────────────────────────────────────────────────────');
  console.log(`TASK:    ${lead.title}`);
  console.log(`SOURCE:  ${lead.source_uri || '(n/a)'}`);
  console.log(`SERVICE: ${lead.service}`);
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
