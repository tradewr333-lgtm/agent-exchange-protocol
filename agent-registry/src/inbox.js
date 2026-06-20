import {
  appendInboxMessage,
  listDiscoveryRewards,
  listInboxMessages,
  listTrustEvents,
  loadContractStore,
} from './store.js';
import { getAgent } from './registry.js';
import { getOpportunitiesForAgent } from './opportunities.js';

export const UNIVERSAL_INBOX_VERSION = '0.1.0';

// The one surface an agent opens each cycle: opportunities + contracts + payments
// + machine-to-machine messages + discovery earnings, unified and time-ordered.
export async function getInbox(agentId, filters = {}) {
  const agent = await getAgent(agentId);
  if (!agent) {
    return { ok: false, status: 404, error: 'agent_not_found', agent_id: agentId };
  }

  const limit = normalizeLimit(filters.limit, 50);

  const [messages, rewards, contractStore, trustEvents, opportunityResult] = await Promise.all([
    listInboxMessages({ agentId, limit }),
    listDiscoveryRewards({ beneficiaryAgentId: agentId, limit }),
    loadContractStore(),
    safeTrustEvents(agentId, limit),
    getOpportunitiesForAgent(agentId, { limit: 5 }),
  ]);

  const contracts = (contractStore.contracts ?? [])
    .filter((contract) => {
      const provider = contract.quote?.provider_agent_id ?? contract.terms?.provider_agent_id;
      const requester = contract.quote?.requester_agent_id ?? contract.terms?.requester_agent_id;
      return provider === agentId || requester === agentId;
    })
    .map((contract) => summarizeContract(contract, agentId))
    .sort((left, right) => Date.parse(right.updated_at ?? 0) - Date.parse(left.updated_at ?? 0))
    .slice(0, limit);

  const opportunities = opportunityResult.ok ? opportunityResult.opportunities : [];
  const discoveryEarnings = rewards.reduce((sum, reward) => sum + Number(reward.amount_axp || 0), 0);
  const unread = messages.filter((message) => !message.read).length;
  const pendingValue = contracts
    .filter((contract) => ['prepared', 'funded', 'accepted'].includes(contract.status))
    .reduce((sum, contract) => sum + Number(contract.value_usd || 0), 0);

  const feed = buildUnifiedFeed({ messages, contracts, trustEvents }).slice(0, limit);

  return {
    ok: true,
    status: 200,
    protocol: 'AXP',
    version: UNIVERSAL_INBOX_VERSION,
    schema: 'axp.universal_inbox.v0',
    agent_id: agentId,
    handle: `axp://${agentId}`,
    generated_at: new Date().toISOString(),
    summary: {
      unread_messages: unread,
      open_opportunities: opportunities.length,
      active_contracts: contracts.filter((contract) => ['prepared', 'funded', 'accepted'].includes(contract.status)).length,
      discovery_earnings_axp: Number(discoveryEarnings.toFixed(6)),
      pending_value_usd: Number(pendingValue.toFixed(2)),
    },
    opportunities,
    contracts,
    messages,
    discovery_rewards: {
      total_axp: Number(discoveryEarnings.toFixed(6)),
      count: rewards.length,
      recent: rewards.slice(0, 10),
    },
    feed,
  };
}

export async function postInboxMessage(agentId, body = {}) {
  const targetAgentId = typeof agentId === 'string' ? agentId.trim() : '';
  if (!targetAgentId) {
    return { ok: false, status: 400, error: 'agent_id_required' };
  }

  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const text = typeof body.body === 'string' ? body.body : (typeof body.message === 'string' ? body.message : '');
  if (!subject && !text) {
    return { ok: false, status: 400, error: 'subject_or_body_required' };
  }

  const target = await getAgent(targetAgentId);
  if (!target) {
    return { ok: false, status: 404, error: 'agent_not_found', agent_id: targetAgentId };
  }

  const stored = await appendInboxMessage({
    agent_id: targetAgentId,
    kind: body.kind ?? 'message',
    subject: subject || '(no subject)',
    from_id: body.from_id ?? body.from ?? 'axp://anonymous',
    ref_id: body.ref_id ?? null,
    value_usd: Number(body.value_usd ?? 0),
    read: false,
    data: { body: text, metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {} },
  });

  return { ok: true, status: 201, message: stored };
}

function summarizeContract(contract, agentId) {
  const provider = contract.quote?.provider_agent_id ?? contract.terms?.provider_agent_id ?? null;
  const value = Number(contract.quote?.requested_capacity ?? contract.terms?.requested_capacity ?? 0);
  return {
    contract_id: contract.contract_id,
    role: provider === agentId ? 'provider' : 'requester',
    counterparty:
      provider === agentId
        ? contract.quote?.requester_agent_id ?? null
        : provider,
    service: contract.quote?.service ?? contract.terms?.service ?? null,
    status: contract.status ?? 'prepared',
    value_usd: value,
    updated_at: contract.updated_at ?? contract.created_at ?? null,
  };
}

function buildUnifiedFeed({ messages, contracts, trustEvents }) {
  const items = [];

  for (const message of messages) {
    items.push({
      type: message.kind ?? 'message',
      at: message.created_at,
      subject: message.subject,
      from: message.from_id,
      ref_id: message.ref_id ?? null,
      read: Boolean(message.read),
    });
  }

  for (const contract of contracts) {
    items.push({
      type: 'contract',
      at: contract.updated_at,
      subject: `Contract ${contract.status} (${contract.service ?? 'service'})`,
      from: contract.counterparty,
      ref_id: contract.contract_id,
      value_usd: contract.value_usd,
    });
  }

  for (const event of trustEvents) {
    items.push({
      type: 'trust_event',
      at: event.created_at,
      subject: event.event_type,
      ref_id: event.contract_id ?? null,
      value_usd: Number(event.value_usd ?? 0),
    });
  }

  return items
    .filter((item) => item.at)
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
}

async function safeTrustEvents(agentId, limit) {
  try {
    const result = await listTrustEvents({ agentId, limit: Math.min(limit, 50) });
    return result.events ?? [];
  } catch {
    return [];
  }
}

function normalizeLimit(value, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }
  return Math.min(Math.trunc(number), 200);
}
