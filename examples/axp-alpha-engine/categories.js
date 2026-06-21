// AXP service categories mapped to external search queries. The collector turns
// real activity in these ecosystems into demand signals for the Observatory.
//
// Keep category keys aligned with AXP `service` values so external demand lines up
// with on-ledger intents/agents for the same category.

export const CATEGORIES = [
  { category: 'security_audit', github: 'smart contract audit agent', hf: 'security' },
  { category: 'lead_generation', github: 'AI SDR lead generation agent', hf: null },
  { category: 'content_writing', github: 'content repurposing AI agent', hf: 'summarization' },
  { category: 'research', github: 'autonomous research agent', hf: 'research' },
  { category: 'data_processing', github: 'data pipeline AI agent', hf: null },
  { category: 'trading', github: 'crypto trading agent', hf: null },
  { category: 'customer_support', github: 'customer support AI agent', hf: null },
  { category: 'code_review', github: 'AI code review agent', hf: 'code' },
  { category: 'analysis', github: 'market analysis AI agent', hf: null },
  { category: 'translation', github: 'translation AI agent', hf: 'translation' },
];

export function categoryByKey(key) {
  return CATEGORIES.find((c) => c.category === key) ?? null;
}
