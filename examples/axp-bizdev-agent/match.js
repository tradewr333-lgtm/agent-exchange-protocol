// AXP BizDev / Outreach Agent — matching + drafting (pure, testable).
//
// "The mountain comes to Muhammad": match real external tasks to the best AXP agent
// and draft an honest outreach with a hire link. NEVER auto-posts — every lead is
// human_review_required. Now with a minimum-trust filter (no offering trust-0 stubs)
// and a fit score for prioritization.

import { inferService } from '../axp-opportunity-miner/normalize.js';

const SERVICE_LABEL = {
  translation: 'translation',
  code_review: 'code review',
  research: 'research',
  data_processing: 'data processing',
  lead_generation: 'lead generation',
  security_audit: 'security audit',
  content_writing: 'content',
  analysis: 'analysis',
  customer_support: 'support',
  trading: 'market research',
  general: 'this',
};

// Best agent offering the service, above a minimum on-chain trust score.
export function bestAgentFor(service, agents = [], minTrust = 0) {
  const candidates = agents.filter((a) => Array.isArray(a.services)
    && a.services.includes(service)
    && (Number(a.trust_score) || 0) >= minTrust);
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => (Number(b.trust_score) || 0) - (Number(a.trust_score) || 0))[0];
}

export function draftOutreach({ item, agent, service, registryUrl, summary }) {
  const label = SERVICE_LABEL[service] || service || 'this';
  const link = agent ? `${registryUrl}/agent/${agent.agent_id}` : `${registryUrl}/store`;
  const who = agent ? agent.name : `an AXP ${label} agent`;
  const cred = agent
    ? `It has a ${Math.round(Number(agent.trust_score) || 0)} on-chain trust score${agent.contracts ? ` and ${agent.contracts} completed jobs` : ''}.`
    : `AXP agents carry on-chain reputation and Proof of Trust on every delivery.`;
  return [
    `Hi — I saw "${item.title}".`,
    `${who} on AXP can take this ${label} task and deliver it, with cryptographic proof of the work.`,
    summary ? `Specifically: ${summary}` : '',
    cred,
    `Hire it here: ${link}`,
    `(Not affiliated with this project — just offering to help. Feel free to ignore.)`,
  ].filter(Boolean).join('\n');
}

// Priority: leads with a real (trust-bearing) matched agent rank highest.
export function fitScore(lead) {
  if (lead.matched_agent) return 100 + (Number(lead.matched_agent.trust_score) || 0);
  return 10; // no agent yet → low priority (launch suggestion)
}

export function buildLead({ item, service, summary = '', agents = [], registryUrl = 'https://axp.network', minTrust = 0 }) {
  const agent = bestAgentFor(service, agents, minTrust);
  const lead = {
    title: item.title,
    source_uri: item.url || item.source_uri || null,
    service,
    summary: summary || null,
    matched_agent: agent
      ? { agent_id: agent.agent_id, name: agent.name, trust_score: Number(agent.trust_score) || 0, hire_link: `${registryUrl}/agent/${agent.agent_id}` }
      : null,
    suggested_template: agent ? null : service,
    draft: draftOutreach({ item, agent, service, registryUrl, summary }),
    channel: 'human_review_required',
  };
  lead.fit_score = fitScore(lead);
  return lead;
}

export function prioritize(leads) {
  return [...leads].sort((a, b) => (b.fit_score || 0) - (a.fit_score || 0));
}

// Keyword-only path (no LLM) — used as a fallback and in tests.
export function matchLeads({ workItems = [], agents = [], registryUrl = 'https://axp.network', minTrust = 0 } = {}) {
  const leads = workItems.map((item) => {
    const { service } = inferService(item);
    return buildLead({ item, service, agents, registryUrl, minTrust });
  });
  return prioritize(leads);
}
