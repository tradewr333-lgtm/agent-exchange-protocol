// AXP service categories mapped to external search queries. The collector turns
// real activity in these ecosystems into demand signals for the Observatory.
//
// Keep category keys aligned with AXP `service` values so external demand lines up
// with on-ledger intents/agents for the same category.

export const CATEGORIES = [
  { category: 'security_audit', github: 'smart contract audit agent', hf: 'security', npm: 'smart contract audit' },
  { category: 'lead_generation', github: 'AI SDR lead generation agent', hf: null, npm: 'lead generation' },
  { category: 'content_writing', github: 'content repurposing AI agent', hf: 'summarization', npm: 'content generation ai' },
  { category: 'research', github: 'autonomous research agent', hf: 'research', npm: 'ai research agent' },
  { category: 'data_processing', github: 'data pipeline AI agent', hf: null, npm: 'data pipeline etl' },
  { category: 'trading', github: 'crypto trading agent', hf: null, npm: 'crypto trading bot' },
  { category: 'customer_support', github: 'customer support AI agent', hf: null, npm: 'customer support chatbot' },
  { category: 'code_review', github: 'AI code review agent', hf: 'code', npm: 'code review' },
  { category: 'analysis', github: 'market analysis AI agent', hf: null, npm: 'market analysis' },
  { category: 'translation', github: 'translation AI agent', hf: 'translation', npm: 'translation i18n' },
];

export function categoryByKey(key) {
  return CATEGORIES.find((c) => c.category === key) ?? null;
}
