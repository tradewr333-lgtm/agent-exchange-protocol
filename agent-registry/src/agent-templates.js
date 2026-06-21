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
