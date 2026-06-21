// Pre-built agent templates — the "no code" catalog a buyer launches from.
// Each maps to an AXP service category so a launched agent immediately matches
// the Opportunity Router and the Observatory's demand signals for that niche.

export const AGENT_TEMPLATES = [
  {
    id: 'research',
    name: 'Research Agent',
    service: 'research',
    skills: ['research', 'summarization', 'report_writing'],
    tagline: 'Researches topics, summarizes documents, and writes reports.',
    capacity_usd: 20000,
    icon: 'R',
  },
  {
    id: 'translation',
    name: 'Translation Agent',
    service: 'translation',
    skills: ['translation', 'localization'],
    tagline: 'Translates and localizes content across languages.',
    capacity_usd: 15000,
    icon: 'T',
  },
  {
    id: 'code_review',
    name: 'Code Review Agent',
    service: 'code_review',
    skills: ['code_review', 'static_analysis', 'security'],
    tagline: 'Reviews pull requests and flags bugs and risks.',
    capacity_usd: 25000,
    icon: 'C',
  },
  {
    id: 'data_processing',
    name: 'Data Processing Agent',
    service: 'data_processing',
    skills: ['data_processing', 'etl', 'classification'],
    tagline: 'Cleans, classifies, and transforms data at scale.',
    capacity_usd: 20000,
    icon: 'D',
  },
  {
    id: 'leadgen',
    name: 'LeadGen Agent',
    service: 'lead_generation',
    skills: ['lead_generation', 'outreach', 'enrichment'],
    tagline: 'Finds, enriches, and qualifies sales leads (AI SDR).',
    capacity_usd: 18000,
    icon: 'L',
  },
  {
    id: 'security_audit',
    name: 'Security Audit Agent',
    service: 'security_audit',
    skills: ['security', 'smart_contracts', 'vulnerability_analysis'],
    tagline: 'Reviews code & smart contracts for bugs and security risks.',
    capacity_usd: 25000,
    icon: 'S',
  },
  {
    id: 'content_writing',
    name: 'Content Agent',
    service: 'content_writing',
    skills: ['copywriting', 'content_repurposing', 'seo'],
    tagline: 'Writes and repurposes content: posts, threads, summaries.',
    capacity_usd: 15000,
    icon: 'W',
  },
  {
    id: 'analysis',
    name: 'Analysis Agent',
    service: 'analysis',
    skills: ['data_analysis', 'market_research', 'reporting'],
    tagline: 'Analyzes data and markets and produces clear briefs.',
    capacity_usd: 20000,
    icon: 'A',
  },
  {
    id: 'customer_support',
    name: 'Support Agent',
    service: 'customer_support',
    skills: ['support', 'triage', 'tone'],
    tagline: 'Drafts helpful, on-brand customer support replies.',
    capacity_usd: 15000,
    icon: 'Q',
  },
  {
    id: 'market_research',
    name: 'Market Research Agent',
    service: 'trading',
    skills: ['market_research', 'crypto', 'summarization'],
    tagline: 'Summarizes public market/crypto information (not financial advice).',
    capacity_usd: 18000,
    icon: 'M',
  },
];

export function templateById(id) {
  return AGENT_TEMPLATES.find((t) => t.id === id) ?? null;
}

export function listTemplates() {
  return AGENT_TEMPLATES.map((t) => ({
    id: t.id, name: t.name, service: t.service, skills: t.skills,
    tagline: t.tagline, capacity_usd: t.capacity_usd, icon: t.icon,
  }));
}
