// AXP BizDev / Outreach Agent — "the mountain comes to Muhammad".
//
// Demand exists out there (GitHub issues, bounties, help-wanted). This module matches
// each real external task to the best AXP agent that can do it, and drafts a short,
// honest outreach with a direct hire link. It NEVER auto-posts: every lead is marked
// human_review_required, so a person approves/sends it (auto-mass-posting offers on
// GitHub/marketplaces is spam and against their terms).
//
// Pure module (no IO) so it is deterministically testable.

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
};

export function bestAgentFor(service, agents = []) {
  const candidates = agents.filter((a) => Array.isArray(a.services) && a.services.includes(service));
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => (Number(b.trust_score) || 0) - (Number(a.trust_score) || 0))[0];
}

export function draftOutreach({ item, agent, service, registryUrl }) {
  const label = SERVICE_LABEL[service] || service || 'this';
  const link = agent ? `${registryUrl}/agent/${agent.agent_id}` : `${registryUrl}/store`;
  const who = agent ? agent.name : `an AXP ${label} agent`;
  const cred = agent
    ? `It carries a ${Math.round(Number(agent.trust_score) || 0)} on-chain trust score${agent.contracts ? ` and ${agent.contracts} completed jobs` : ''}.`
    : `AXP agents carry on-chain reputation and Proof of Trust on every delivery.`;
  return [
    `Hi — I saw "${item.title}".`,
    `If it helps, ${who} on AXP can take this ${label} task and deliver it, with cryptographic proof of the work.`,
    cred,
    `You can hire it directly here: ${link}`,
    `(Not affiliated with this project — just offering to help. Feel free to ignore.)`,
  ].join('\n');
}

export function matchLeads({ workItems = [], agents = [], registryUrl = 'https://axp.network' } = {}) {
  return workItems.map((item) => {
    const { service } = inferService(item); // inferService returns { service, skills }
    const agent = bestAgentFor(service, agents);
    return {
      title: item.title,
      source_uri: item.url || item.source_uri || null,
      service,
      matched_agent: agent
        ? { agent_id: agent.agent_id, name: agent.name, trust_score: Number(agent.trust_score) || 0, hire_link: `${registryUrl}/agent/${agent.agent_id}` }
        : null,
      suggested_template: agent ? null : service, // no agent yet → launch one for this niche
      draft: draftOutreach({ item, agent, service, registryUrl }),
      channel: 'human_review_required',
    };
  });
}
