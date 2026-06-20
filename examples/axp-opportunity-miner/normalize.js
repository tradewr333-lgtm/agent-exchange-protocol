// Pure, dependency-free normalization: raw work item -> AXP intent.
// Kept side-effect free so it can be unit tested deterministically.

// Ordered service taxonomy. First matching rule wins.
const SERVICE_RULES = [
  { service: 'security_audit', skills: ['solidity', 'audit'], keywords: ['audit', 'security', 'vulnerab', 'exploit', 'reentran', 'cve'] },
  { service: 'smart_contract_dev', skills: ['solidity'], keywords: ['smart contract', 'solidity', 'evm', 'erc20', 'erc-20', 'hardhat'] },
  { service: 'research', skills: ['research'], keywords: ['research', 'analysis', 'analyze', 'investigate', 'literature', 'survey'] },
  { service: 'data_processing', skills: ['data'], keywords: ['classify', 'label', 'dataset', 'parse', 'scrape', 'etl', 'clean data'] },
  { service: 'translation', skills: ['translation'], keywords: ['translate', 'translation', 'localize', 'localization', 'i18n'] },
  { service: 'content_writing', skills: ['writing'], keywords: ['write', 'blog', 'article', 'documentation', 'docs', 'copywriting'] },
  { service: 'frontend_dev', skills: ['frontend'], keywords: ['frontend', 'react', 'ui', 'css', 'web app'] },
  { service: 'backend_dev', skills: ['backend'], keywords: ['backend', 'api', 'database', 'server', 'endpoint'] },
];

const URGENCY_KEYWORDS = {
  CRITICAL: ['critical', 'urgent', 'asap', 'security', 'exploit', 'production down'],
  HIGH: ['high priority', 'important', 'bounty', 'deadline'],
  LOW: ['nice to have', 'someday', 'low priority', 'backlog'],
};

export function inferService(item) {
  const haystack = `${item.title ?? ''} ${item.body ?? ''} ${(item.labels ?? []).join(' ')}`.toLowerCase();
  for (const rule of SERVICE_RULES) {
    if (rule.keywords.some((keyword) => haystack.includes(keyword))) {
      return { service: rule.service, skills: rule.skills };
    }
  }
  return { service: 'general', skills: [] };
}

export function inferUrgency(item) {
  const haystack = `${item.title ?? ''} ${(item.labels ?? []).join(' ')}`.toLowerCase();
  for (const [level, keywords] of Object.entries(URGENCY_KEYWORDS)) {
    if (keywords.some((keyword) => haystack.includes(keyword))) {
      return level;
    }
  }
  const reward = Number(item.reward_usd) || 0;
  if (reward >= 5000) return 'HIGH';
  if (reward > 0) return 'MEDIUM';
  return 'MEDIUM';
}

export function estimateReward(item) {
  const explicit = Number(item.reward_usd ?? item.bounty_usd);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.round(explicit);
  }
  // Heuristic fallback by label signal when no bounty is attached.
  const labels = (item.labels ?? []).map((label) => String(label).toLowerCase());
  if (labels.some((label) => label.includes('bounty'))) return 1000;
  if (labels.some((label) => label.includes('good first'))) return 150;
  return 0;
}

// required_capacity_usd: collateral an agent should have free to credibly take the job.
function estimateRequiredCapacity(rewardUsd) {
  if (rewardUsd <= 0) return 100;
  return Math.max(100, Math.round(rewardUsd * 0.5));
}

export function workItemToIntent(item) {
  if (!item || typeof item !== 'object' || !item.title) {
    return null;
  }
  const { service, skills } = inferService(item);
  const reward = estimateReward(item);
  const urgency = inferUrgency(item);

  return {
    title: String(item.title).slice(0, 200),
    description: String(item.body ?? '').slice(0, 1000),
    service,
    skills,
    reward_usd: reward,
    urgency,
    required_capacity_usd: estimateRequiredCapacity(reward),
    min_trust_score: service === 'security_audit' ? 1000 : 0,
    source: item.source ?? 'opportunity_miner',
    source_uri: item.url ?? item.source_uri ?? null,
    metadata: {
      external_id: item.id ?? item.url ?? null,
      labels: item.labels ?? [],
      mined_at: new Date().toISOString(),
    },
  };
}

// Build a stable dedupe key for a work item / intent.
export function dedupeKey(intentOrItem) {
  return (
    intentOrItem.source_uri
    ?? intentOrItem.metadata?.external_id
    ?? intentOrItem.url
    ?? intentOrItem.id
    ?? intentOrItem.title
    ?? null
  );
}
