import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.AXP_DATA_DIR
  ? process.env.AXP_DATA_DIR
  : join(currentDir, '..', 'data');

export const paths = {
  agents: join(dataDir, 'agents.json'),
  apiKeys: join(dataDir, 'api-keys.json'),
  contracts: join(dataDir, 'contracts.json'),
  intents: join(dataDir, 'intents.json'),
  inbox: join(dataDir, 'inbox.json'),
  lineage: join(dataDir, 'lineage.json'),
  discoveryRewards: join(dataDir, 'discovery-rewards.json'),
  growthState: join(dataDir, 'growth-state.json'),
  externalSignals: join(dataDir, 'external-signals.json'),
  subscriptions: join(dataDir, 'subscriptions.json'),
  launchPayments: join(dataDir, 'launch-payments.json'),
  hires: join(dataDir, 'hires.json'),
  observations: join(dataDir, 'observations.json'),
  predictions: join(dataDir, 'predictions.json'),
  credits: join(dataDir, 'credits.json'),
  derivatives: join(dataDir, 'derivatives.json'),
  deribitCreds: join(dataDir, 'deribit-creds.json'),
};

let poolPromise = null;
// axp-economy-layer storage extensions present below

export function storageMode() {
  return process.env.DATABASE_URL ? 'postgres' : 'json';
}

export function readJsonFile(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

export async function loadAgentsRegistry() {
  if (storageMode() === 'postgres') {
    const result = await query('select data from agents order by agent_id asc');
    return {
      schema: 'axp.agent_registry.v0',
      network: 'bsc-mainnet',
      updated_at: latestUpdatedAt(result.rows.map((row) => row.data)),
      count: result.rows.length,
      agents: result.rows.map((row) => row.data),
    };
  }

  return readJsonFile(paths.agents);
}

export async function saveAgentsRegistry(registry) {
  const updatedRegistry = {
    ...registry,
    updated_at: new Date().toISOString(),
  };

  if (storageMode() === 'postgres') {
    for (const agent of updatedRegistry.agents) {
      await query(
        `insert into agents (agent_id, status, services, data, updated_at)
         values ($1, $2, $3, $4::jsonb, now())
         on conflict (agent_id) do update set
           status = excluded.status,
           services = excluded.services,
           data = excluded.data,
           updated_at = now()`,
        [
          agent.agent_id,
          agent.status ?? null,
          Array.isArray(agent.services) ? agent.services : [],
          JSON.stringify(agent),
        ],
      );
    }

    return updatedRegistry;
  }

  writeJsonAtomic(paths.agents, updatedRegistry);
  return updatedRegistry;
}

// Append a single new agent to the registry (used by miner deploy). Resilient to a
// missing agents file (fresh install).
export async function addAgent(agent) {
  let registry;
  try { registry = await loadAgentsRegistry(); }
  catch { registry = { schema: 'axp.agent_registry.v0', agents: [] }; }
  if (!Array.isArray(registry.agents)) registry.agents = [];
  if (registry.agents.some((a) => a.agent_id === agent.agent_id)) return agent;
  await saveAgentsRegistry({ ...registry, agents: [...registry.agents, agent] });
  return agent;
}

export async function loadApiKeyRegistry() {
  if (storageMode() === 'postgres') {
    const result = await query('select data from api_keys order by created_at asc');
    return {
      schema: 'axp.api_keys.v0',
      network: 'bsc-mainnet',
      updated_at: latestUpdatedAt(result.rows.map((row) => row.data)),
      count: result.rows.length,
      keys: result.rows.map((row) => row.data),
    };
  }

  return readJsonFile(paths.apiKeys);
}

export async function saveApiKeyRegistry(registry) {
  const updatedRegistry = {
    ...registry,
    updated_at: new Date().toISOString(),
  };

  if (storageMode() === 'postgres') {
    for (const key of updatedRegistry.keys) {
      await query(
        `insert into api_keys (key_id, owner_address, agent_id, status, secret_hash, data, updated_at)
         values ($1, $2, $3, $4, $5, $6::jsonb, now())
         on conflict (key_id) do update set
           owner_address = excluded.owner_address,
           agent_id = excluded.agent_id,
           status = excluded.status,
           secret_hash = excluded.secret_hash,
           data = excluded.data,
           updated_at = now()`,
        [
          key.key_id,
          key.owner,
          key.agent_id ?? null,
          key.status ?? 'active',
          key.secret_hash,
          JSON.stringify(key),
        ],
      );
    }

    return updatedRegistry;
  }

  writeJsonAtomic(paths.apiKeys, updatedRegistry);
  return updatedRegistry;
}

export async function loadContractStore() {
  if (storageMode() === 'postgres') {
    const result = await query('select data from contracts order by created_at asc');
    return {
      schema: 'axp.contract_store.v0',
      updated_at: latestUpdatedAt(result.rows.map((row) => row.data)),
      contracts: result.rows.map((row) => row.data),
    };
  }

  if (!existsSync(paths.contracts)) {
    return createEmptyContractStore();
  }

  try {
    const store = readJsonFile(paths.contracts);
    if (!Array.isArray(store.contracts)) {
      return createEmptyContractStore();
    }

    return {
      schema: store.schema ?? 'axp.contract_store.v0',
      updated_at: store.updated_at ?? null,
      contracts: store.contracts,
    };
  } catch {
    return createEmptyContractStore();
  }
}

export async function saveContractStore(store) {
  const updatedStore = {
    ...store,
    updated_at: store.updated_at ?? new Date().toISOString(),
  };

  if (storageMode() === 'postgres') {
    for (const contract of updatedStore.contracts) {
      await query(
        `insert into contracts (contract_id, requester_agent_id, provider_agent_id, status, service, requested_capacity_usd, data, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
         on conflict (contract_id) do update set
           requester_agent_id = excluded.requester_agent_id,
           provider_agent_id = excluded.provider_agent_id,
           status = excluded.status,
           service = excluded.service,
           requested_capacity_usd = excluded.requested_capacity_usd,
           data = excluded.data,
           updated_at = now()`,
        [
          contract.contract_id,
          contract.quote?.requester_agent_id ?? null,
          contract.quote?.provider_agent_id ?? null,
          contract.status ?? null,
          contract.quote?.service ?? contract.terms?.service ?? null,
          Number(contract.quote?.requested_capacity ?? contract.terms?.requested_capacity ?? 0),
          JSON.stringify(contract),
        ],
      );
    }

    return updatedStore;
  }

  writeJsonAtomic(paths.contracts, updatedStore);
  return updatedStore;
}

export async function appendHeartbeatEvent(agentId, heartbeat) {
  if (storageMode() !== 'postgres') {
    return;
  }

  await query(
    `insert into heartbeats (agent_id, status, available, current_load, available_capacity_usd, endpoint, data)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      agentId,
      heartbeat.status ?? null,
      Boolean(heartbeat.available),
      Number(heartbeat.current_load ?? 0),
      Number(heartbeat.available_capacity ?? 0),
      heartbeat.endpoint ?? null,
      JSON.stringify(heartbeat),
    ],
  );
}

export async function appendSettlementEvent(contractId, settlement) {
  if (storageMode() !== 'postgres') {
    return;
  }

  await query(
    `insert into settlements (contract_id, outcome, reported_by, data)
     values ($1, $2, $3, $4::jsonb)`,
    [
      contractId,
      settlement.outcome ?? null,
      settlement.reported_by ?? null,
      JSON.stringify(settlement),
    ],
  );
}

export async function appendTrustEvent(event) {
  if (storageMode() !== 'postgres') {
    return;
  }

  await query(
    `insert into trust_events (event_type, agent_id, counterparty_id, contract_id, value_usd, data)
     values ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      event.event_type,
      event.agent_id ?? null,
      event.counterparty_id ?? null,
      event.contract_id ?? null,
      Number(event.value_usd ?? 0),
      JSON.stringify(event),
    ],
  );
}

export async function appendApiUsage(event) {
  if (storageMode() !== 'postgres') {
    return;
  }

  await query(
    `insert into api_usage (key_id, usage_type, agent_id, path, data)
     values ($1, $2, $3, $4, $5::jsonb)`,
    [
      event.key_id,
      event.usage_type,
      event.agent_id ?? null,
      event.path ?? null,
      JSON.stringify(event),
    ],
  );
}

export async function listTrustEvents(filters = {}) {
  const limit = normalizeLimit(filters.limit, 100);
  if (storageMode() !== 'postgres') {
    return {
      schema: 'axp.trust_events.v0',
      storage_mode: 'json',
      count: 0,
      events: [],
    };
  }

  const clauses = [];
  const params = [];
  addWhere(clauses, params, 'agent_id', filters.agentId);
  addWhere(clauses, params, 'event_type', filters.eventType);
  addWhere(clauses, params, 'contract_id', filters.contractId);
  addWhere(clauses, params, 'counterparty_id', filters.counterpartyId);
  params.push(limit);

  const result = await query(
    `select id, event_type, agent_id, counterparty_id, contract_id, value_usd, data, created_at
     from trust_events
     ${clauses.length > 0 ? `where ${clauses.join(' and ')}` : ''}
     order by created_at desc, id desc
     limit $${params.length}`,
    params,
  );

  return {
    schema: 'axp.trust_events.v0',
    storage_mode: 'postgres',
    count: result.rows.length,
    filters: {
      agent_id: filters.agentId ?? null,
      event_type: filters.eventType ?? null,
      contract_id: filters.contractId ?? null,
      counterparty_id: filters.counterpartyId ?? null,
      limit,
    },
    events: result.rows.map(formatLedgerRow),
  };
}

export async function listTrustEventsAfterId(afterId = 0, limitValue = 100) {
  const limit = normalizeLimit(limitValue, 100);
  if (storageMode() !== 'postgres') {
    return {
      schema: 'axp.trust_events.anchor_batch.v0',
      storage_mode: 'json',
      count: 0,
      events: [],
    };
  }

  const result = await query(
    `select id, event_type, agent_id, counterparty_id, contract_id, value_usd, data, created_at
     from trust_events
     where id > $1
     order by id asc
     limit $2`,
    [Number(afterId ?? 0), limit],
  );

  return {
    schema: 'axp.trust_events.anchor_batch.v0',
    storage_mode: 'postgres',
    count: result.rows.length,
    after_event_id: Number(afterId ?? 0),
    limit,
    events: result.rows.map(formatLedgerRow),
  };
}

export async function listTrustAnchors(filters = {}) {
  const limit = normalizeLimit(filters.limit, 100);
  if (storageMode() !== 'postgres') {
    return {
      schema: 'axp.trust_anchors.v0',
      storage_mode: 'json',
      count: 0,
      anchors: [],
    };
  }

  const clauses = [];
  const params = [];
  addWhere(clauses, params, 'status', filters.status);
  params.push(limit);

  const result = await query(
    `select id, batch_id, merkle_root, from_event_id, to_event_id, event_count, chain_id,
       contract_address, tx_hash, block_number, status, data, created_at, updated_at
     from trust_anchors
     ${clauses.length > 0 ? `where ${clauses.join(' and ')}` : ''}
     order by created_at desc, id desc
     limit $${params.length}`,
    params,
  );

  return {
    schema: 'axp.trust_anchors.v0',
    storage_mode: 'postgres',
    count: result.rows.length,
    filters: {
      status: filters.status ?? null,
      limit,
    },
    anchors: result.rows.map(formatAnchorRow),
  };
}

export async function getLatestTrustAnchor(filters = {}) {
  if (storageMode() !== 'postgres') {
    return null;
  }

  const clauses = [];
  const params = [];
  addWhere(clauses, params, 'status', filters.status);
  const result = await query(
    `select id, batch_id, merkle_root, from_event_id, to_event_id, event_count, chain_id,
       contract_address, tx_hash, block_number, status, data, created_at, updated_at
     from trust_anchors
     ${clauses.length > 0 ? `where ${clauses.join(' and ')}` : ''}
     order by to_event_id desc, id desc
     limit 1`,
    params,
  );

  return result.rows[0] ? formatAnchorRow(result.rows[0]) : null;
}

export async function saveTrustAnchor(anchor) {
  if (storageMode() !== 'postgres') {
    return {
      ...anchor,
      storage_mode: 'json',
      status: anchor.status ?? 'prepared',
    };
  }

  await query(
    `insert into trust_anchors (
       batch_id, merkle_root, from_event_id, to_event_id, event_count, chain_id,
       contract_address, tx_hash, block_number, status, data, updated_at
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, now())
     on conflict (batch_id) do update set
       merkle_root = excluded.merkle_root,
       from_event_id = excluded.from_event_id,
       to_event_id = excluded.to_event_id,
       event_count = excluded.event_count,
       chain_id = excluded.chain_id,
       contract_address = excluded.contract_address,
       tx_hash = excluded.tx_hash,
       block_number = excluded.block_number,
       status = excluded.status,
       data = excluded.data,
       updated_at = now()`,
    [
      anchor.batch_id,
      anchor.merkle_root,
      Number(anchor.from_event_id),
      Number(anchor.to_event_id),
      Number(anchor.event_count),
      anchor.chain_id ?? null,
      anchor.contract_address ?? null,
      anchor.tx_hash ?? null,
      anchor.block_number ?? null,
      anchor.status ?? 'prepared',
      JSON.stringify(anchor),
    ],
  );

  const anchors = await listTrustAnchors({ limit: 1 });
  return anchors.anchors.find((item) => item.batch_id === anchor.batch_id) ?? anchor;
}

export async function listApiUsage(filters = {}) {
  const limit = normalizeLimit(filters.limit, 100);
  if (storageMode() !== 'postgres') {
    return {
      schema: 'axp.api_usage.v0',
      storage_mode: 'json',
      count: 0,
      usage: [],
    };
  }

  const clauses = [];
  const params = [];
  addWhere(clauses, params, 'key_id', filters.keyId);
  addWhere(clauses, params, 'usage_type', filters.usageType);
  addWhere(clauses, params, 'agent_id', filters.agentId);
  addWhere(clauses, params, 'path', filters.path);
  params.push(limit);

  const result = await query(
    `select id, key_id, usage_type, agent_id, path, data, created_at
     from api_usage
     ${clauses.length > 0 ? `where ${clauses.join(' and ')}` : ''}
     order by created_at desc, id desc
     limit $${params.length}`,
    params,
  );

  return {
    schema: 'axp.api_usage.v0',
    storage_mode: 'postgres',
    count: result.rows.length,
    filters: {
      key_id: filters.keyId ?? null,
      usage_type: filters.usageType ?? null,
      agent_id: filters.agentId ?? null,
      path: filters.path ?? null,
      limit,
    },
    usage: result.rows.map(formatLedgerRow),
  };
}

// ---------------------------------------------------------------------------
// AXP Agent Economy Layer storage (intents, inbox, lineage, rewards, growth)
// ---------------------------------------------------------------------------

export async function loadIntents() {
  if (storageMode() === 'postgres') {
    const result = await query('select data from intents order by created_at asc');
    return result.rows.map((row) => row.data);
  }

  return readCollection(paths.intents, 'intents');
}

export async function saveIntent(intent) {
  if (storageMode() === 'postgres') {
    await query(
      `insert into intents (intent_id, title, service, status, reward_usd, urgency,
         required_capacity_usd, min_trust_score, source, requester, claimed_by, data, updated_at, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb, now(), $13)
       on conflict (intent_id) do update set
         title = excluded.title,
         service = excluded.service,
         status = excluded.status,
         reward_usd = excluded.reward_usd,
         urgency = excluded.urgency,
         required_capacity_usd = excluded.required_capacity_usd,
         min_trust_score = excluded.min_trust_score,
         source = excluded.source,
         requester = excluded.requester,
         claimed_by = excluded.claimed_by,
         data = excluded.data,
         updated_at = now(),
         expires_at = excluded.expires_at`,
      [
        intent.intent_id,
        intent.title ?? '',
        intent.service ?? null,
        intent.status ?? 'open',
        Number(intent.reward_usd ?? 0),
        intent.urgency ?? 'MEDIUM',
        Number(intent.required_capacity_usd ?? 0),
        Number(intent.min_trust_score ?? 0),
        intent.source ?? null,
        intent.requester ?? null,
        intent.claimed_by ?? null,
        JSON.stringify(intent),
        intent.expires_at ?? null,
      ],
    );
    return intent;
  }

  const intents = readCollection(paths.intents, 'intents');
  const index = intents.findIndex((item) => item.intent_id === intent.intent_id);
  if (index >= 0) {
    intents[index] = intent;
  } else {
    intents.push(intent);
  }
  writeCollection(paths.intents, 'intents', intents);
  return intent;
}

export async function appendInboxMessage(message) {
  if (storageMode() === 'postgres') {
    const result = await query(
      `insert into inbox_messages (agent_id, kind, subject, from_id, ref_id, value_usd, read, data)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       returning id, created_at`,
      [
        message.agent_id,
        message.kind,
        message.subject ?? null,
        message.from_id ?? null,
        message.ref_id ?? null,
        Number(message.value_usd ?? 0),
        Boolean(message.read ?? false),
        JSON.stringify(message),
      ],
    );
    return { ...message, id: Number(result.rows[0].id), created_at: result.rows[0].created_at };
  }

  const messages = readCollection(paths.inbox, 'messages');
  const id = messages.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
  const stored = {
    ...message,
    id,
    read: Boolean(message.read ?? false),
    created_at: message.created_at ?? new Date().toISOString(),
  };
  messages.push(stored);
  writeCollection(paths.inbox, 'messages', messages);
  return stored;
}

export async function listInboxMessages(filters = {}) {
  const limit = normalizeLimit(filters.limit, 200);
  if (storageMode() === 'postgres') {
    const clauses = [];
    const params = [];
    addWhere(clauses, params, 'agent_id', filters.agentId);
    addWhere(clauses, params, 'kind', filters.kind);
    params.push(limit);
    const result = await query(
      `select id, agent_id, kind, subject, from_id, ref_id, value_usd, read, data, created_at
       from inbox_messages
       ${clauses.length > 0 ? `where ${clauses.join(' and ')}` : ''}
       order by created_at desc, id desc
       limit $${params.length}`,
      params,
    );
    return result.rows.map((row) => ({
      ...row.data,
      id: Number(row.id),
      read: Boolean(row.read),
      created_at: row.created_at,
    }));
  }

  let messages = readCollection(paths.inbox, 'messages');
  if (filters.agentId) {
    messages = messages.filter((item) => item.agent_id === filters.agentId);
  }
  if (filters.kind) {
    messages = messages.filter((item) => item.kind === filters.kind);
  }
  return messages
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
    .slice(0, limit);
}

export async function loadLineage() {
  if (storageMode() === 'postgres') {
    const result = await query('select data from agent_lineage order by created_at asc');
    return result.rows.map((row) => row.data);
  }

  return readCollection(paths.lineage, 'lineage');
}

export async function getLineageNode(agentId) {
  const lineage = await loadLineage();
  return lineage.find((item) => item.agent_id === agentId) ?? null;
}

export async function saveLineageNode(node) {
  if (storageMode() === 'postgres') {
    await query(
      `insert into agent_lineage (agent_id, handle, sponsor_agent_id, depth, origin, spawned_for_intent, data, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb, now())
       on conflict (agent_id) do update set
         handle = excluded.handle,
         sponsor_agent_id = excluded.sponsor_agent_id,
         depth = excluded.depth,
         origin = excluded.origin,
         spawned_for_intent = excluded.spawned_for_intent,
         data = excluded.data,
         updated_at = now()`,
      [
        node.agent_id,
        node.handle ?? null,
        node.sponsor_agent_id ?? null,
        Number(node.depth ?? 0),
        node.origin ?? null,
        node.spawned_for_intent ?? null,
        JSON.stringify(node),
      ],
    );
    return node;
  }

  const lineage = readCollection(paths.lineage, 'lineage');
  const index = lineage.findIndex((item) => item.agent_id === node.agent_id);
  if (index >= 0) {
    lineage[index] = node;
  } else {
    lineage.push(node);
  }
  writeCollection(paths.lineage, 'lineage', lineage);
  return node;
}

export async function appendDiscoveryReward(reward) {
  if (storageMode() === 'postgres') {
    const result = await query(
      `insert into discovery_rewards (beneficiary_agent_id, source_agent_id, contract_id, intent_id, level, amount_axp, reward_multiplier, data)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       returning id, created_at`,
      [
        reward.beneficiary_agent_id,
        reward.source_agent_id ?? null,
        reward.contract_id ?? null,
        reward.intent_id ?? null,
        Number(reward.level ?? 1),
        Number(reward.amount_axp ?? 0),
        Number(reward.reward_multiplier ?? 1),
        JSON.stringify(reward),
      ],
    );
    return { ...reward, id: Number(result.rows[0].id), created_at: result.rows[0].created_at };
  }

  const rewards = readCollection(paths.discoveryRewards, 'rewards');
  const id = rewards.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
  const stored = { ...reward, id, created_at: reward.created_at ?? new Date().toISOString() };
  rewards.push(stored);
  writeCollection(paths.discoveryRewards, 'rewards', rewards);
  return stored;
}

export async function listDiscoveryRewards(filters = {}) {
  const limit = normalizeLimit(filters.limit, 200);
  if (storageMode() === 'postgres') {
    const clauses = [];
    const params = [];
    addWhere(clauses, params, 'beneficiary_agent_id', filters.beneficiaryAgentId);
    addWhere(clauses, params, 'source_agent_id', filters.sourceAgentId);
    params.push(limit);
    const result = await query(
      `select id, beneficiary_agent_id, source_agent_id, contract_id, intent_id, level, amount_axp, reward_multiplier, data, created_at
       from discovery_rewards
       ${clauses.length > 0 ? `where ${clauses.join(' and ')}` : ''}
       order by created_at desc, id desc
       limit $${params.length}`,
      params,
    );
    return result.rows.map((row) => ({
      ...row.data,
      id: Number(row.id),
      amount_axp: Number(row.amount_axp),
      created_at: row.created_at,
    }));
  }

  let rewards = readCollection(paths.discoveryRewards, 'rewards');
  if (filters.beneficiaryAgentId) {
    rewards = rewards.filter((item) => item.beneficiary_agent_id === filters.beneficiaryAgentId);
  }
  if (filters.sourceAgentId) {
    rewards = rewards.filter((item) => item.source_agent_id === filters.sourceAgentId);
  }
  return rewards
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
    .slice(0, limit);
}

export async function loadGrowthState() {
  if (storageMode() === 'postgres') {
    const result = await query("select data from growth_state where id = 'singleton'");
    return result.rows[0] ? result.rows[0].data : null;
  }

  if (!existsSync(paths.growthState)) {
    return null;
  }
  try {
    return readJsonFile(paths.growthState);
  } catch {
    return null;
  }
}

export async function saveGrowthState(state) {
  const updated = { ...state, updated_at: new Date().toISOString() };
  if (storageMode() === 'postgres') {
    await query(
      `insert into growth_state (id, reward_multiplier, treasury_budget_axp, treasury_spent_axp, target_k, data, updated_at)
       values ('singleton', $1, $2, $3, $4, $5::jsonb, now())
       on conflict (id) do update set
         reward_multiplier = excluded.reward_multiplier,
         treasury_budget_axp = excluded.treasury_budget_axp,
         treasury_spent_axp = excluded.treasury_spent_axp,
         target_k = excluded.target_k,
         data = excluded.data,
         updated_at = now()`,
      [
        Number(updated.reward_multiplier ?? 1),
        Number(updated.treasury_budget_axp ?? 0),
        Number(updated.treasury_spent_axp ?? 0),
        Number(updated.target_k ?? 1.5),
        JSON.stringify(updated),
      ],
    );
    return updated;
  }

  writeJsonAtomic(paths.growthState, updated);
  return updated;
}

// ---------------------------------------------------------------------------
// AXP Alpha Engine: external demand signals (GitHub/HuggingFace/MCP/marketplace)
// ---------------------------------------------------------------------------

export async function appendExternalSignals(signals) {
  const list = Array.isArray(signals) ? signals : [signals];
  if (list.length === 0) return 0;

  if (storageMode() === 'postgres') {
    for (const s of list) {
      await query(
        `insert into external_signals (source, category, metric, value, growth_pct, query, observed_at, data)
         values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [
          s.source,
          s.category,
          s.metric ?? 'count',
          Number(s.value ?? 0),
          Number(s.growth_pct ?? 0),
          s.query ?? null,
          s.observed_at ?? new Date().toISOString(),
          JSON.stringify(s),
        ],
      );
    }
    return list.length;
  }

  const existing = readCollection(paths.externalSignals, 'signals');
  // Bound the JSON file: keep the most recent 2000 signals.
  const merged = [...existing, ...list].slice(-2000);
  writeCollection(paths.externalSignals, 'signals', merged);
  return list.length;
}

export async function loadExternalSignals({ sinceMs } = {}) {
  const cutoff = Number.isFinite(sinceMs) ? Date.now() - sinceMs : null;
  if (storageMode() === 'postgres') {
    const params = [];
    let where = '';
    if (cutoff) {
      params.push(new Date(cutoff).toISOString());
      where = 'where observed_at >= $1';
    }
    const result = await query(
      `select data from external_signals ${where} order by observed_at desc limit 2000`,
      params,
    );
    return result.rows.map((row) => row.data);
  }

  let list = readCollection(paths.externalSignals, 'signals');
  if (cutoff) list = list.filter((s) => Date.parse(s.observed_at ?? '') >= cutoff);
  return list;
}

// ---------------------------------------------------------------------------
// AXP Marketplace: subscriptions (Stripe hosting), launch payments, agent patch
// ---------------------------------------------------------------------------

export async function saveSubscription(sub) {
  const record = { ...sub, updated_at: new Date().toISOString() };
  if (storageMode() === 'postgres') {
    await query(
      `insert into subscriptions (id, customer, agent_id, plan_sku, status, owner_ref, current_period_end, data, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb, now())
       on conflict (id) do update set
         customer = excluded.customer, agent_id = excluded.agent_id, plan_sku = excluded.plan_sku,
         status = excluded.status, owner_ref = excluded.owner_ref,
         current_period_end = excluded.current_period_end, data = excluded.data, updated_at = now()`,
      [
        record.id, record.customer ?? null, record.agent_id ?? null, record.plan_sku ?? null,
        record.status ?? null, record.owner_ref ?? null, record.current_period_end ?? null,
        JSON.stringify(record),
      ],
    );
    return record;
  }
  const subs = readCollection(paths.subscriptions, 'subscriptions');
  const i = subs.findIndex((s) => s.id === record.id);
  if (i >= 0) subs[i] = record; else subs.push(record);
  writeCollection(paths.subscriptions, 'subscriptions', subs);
  return record;
}

export async function loadSubscriptions(filters = {}) {
  if (storageMode() === 'postgres') {
    const clauses = [];
    const params = [];
    addWhere(clauses, params, 'agent_id', filters.agentId);
    addWhere(clauses, params, 'status', filters.status);
    const result = await query(
      `select data from subscriptions ${clauses.length ? `where ${clauses.join(' and ')}` : ''} order by updated_at desc limit 500`,
      params,
    );
    return result.rows.map((row) => row.data);
  }
  let subs = readCollection(paths.subscriptions, 'subscriptions');
  if (filters.agentId) subs = subs.filter((s) => s.agent_id === filters.agentId);
  if (filters.status) subs = subs.filter((s) => s.status === filters.status);
  return subs;
}

export async function appendLaunchPayment(payment) {
  const record = { ...payment, created_at: payment.created_at ?? new Date().toISOString() };
  if (storageMode() === 'postgres') {
    await query(
      `insert into launch_payments (agent_id, owner_address, asset, amount, tx_hash, verified, data)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [
        record.agent_id ?? null, record.owner_address ?? null, record.asset ?? null,
        Number(record.amount ?? 0), record.tx_hash ?? null, Boolean(record.verified), JSON.stringify(record),
      ],
    );
    return record;
  }
  const list = readCollection(paths.launchPayments, 'payments');
  list.push(record);
  writeCollection(paths.launchPayments, 'payments', list.slice(-5000));
  return record;
}

export async function launchPaymentExists(txHash) {
  if (!txHash) return false;
  if (storageMode() === 'postgres') {
    const result = await query('select 1 from launch_payments where tx_hash = $1 limit 1', [txHash]);
    return result.rows.length > 0;
  }
  return readCollection(paths.launchPayments, 'payments').some((p) => p.tx_hash === txHash);
}

export async function appendHire(record) {
  const stored = { ...record, created_at: record.created_at ?? new Date().toISOString() };
  if (storageMode() === 'postgres') {
    await query(
      `insert into hires (agent_id, customer_address, asset, amount, fee_usd, owner_usd, tx_hash, payout_tx, status, task, deliverable, data)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
      [
        stored.agent_id ?? null, stored.customer_address ?? null, stored.asset ?? null,
        Number(stored.amount ?? 0), Number(stored.fee_usd ?? 0), Number(stored.owner_usd ?? 0),
        stored.tx_hash ?? null, stored.payout_tx ?? null, stored.status ?? null,
        (stored.task ?? '').slice(0, 4000), (stored.deliverable ?? '').slice(0, 8000),
        JSON.stringify(stored),
      ],
    );
    return stored;
  }
  const list = readCollection(paths.hires, 'hires');
  list.push(stored);
  writeCollection(paths.hires, 'hires', list.slice(-5000));
  return stored;
}

export async function loadHires(filters = {}) {
  if (storageMode() === 'postgres') {
    const clauses = [];
    const params = [];
    addWhere(clauses, params, 'agent_id', filters.agentId);
    const result = await query(
      `select data from hires ${clauses.length ? `where ${clauses.join(' and ')}` : ''} order by created_at desc limit 200`,
      params,
    );
    return result.rows.map((row) => row.data);
  }
  let list = readCollection(paths.hires, 'hires');
  if (filters.agentId) list = list.filter((h) => h.agent_id === filters.agentId);
  return list.slice(-200).reverse();
}

export async function hireExists(txHash) {
  if (!txHash) return false;
  if (storageMode() === 'postgres') {
    const result = await query('select 1 from hires where tx_hash = $1 limit 1', [txHash]);
    return result.rows.length > 0;
  }
  return readCollection(paths.hires, 'hires').some((h) => h.tx_hash === txHash);
}

// --- Decision API: price OBSERVATIONS from miner agents ---
// Stored in a rolling JSON window in BOTH modes: observations are short-lived,
// high-volume and re-submitted every cycle, so losing them on redeploy is fine and
// avoids a Postgres migration. Capped to the most recent entries.
export async function appendObservations(records = []) {
  const now = new Date().toISOString();
  const stored = records
    .filter((r) => r && r.symbol)
    .map((r) => ({ ...r, ts: Number(r.ts || r.timestamp || Date.now()), received_at: now }));
  if (!stored.length) return 0;
  const list = readCollection(paths.observations, 'observations');
  list.push(...stored);
  writeCollection(paths.observations, 'observations', list.slice(-8000));
  return stored.length;
}

export async function loadRecentObservations({ maxAgeMs = 5 * 60 * 1000, now = Date.now() } = {}) {
  const list = readCollection(paths.observations, 'observations');
  return list.filter((o) => o && Number(o.ts) > 0 && now - Number(o.ts) <= maxAgeMs);
}

// Latest derivatives context (funding rate + open interest) per symbol. Small object,
// freshest-wins. Real market signal from public perp APIs.
export async function saveDerivatives(bySymbol = {}) {
  writeJsonAtomic(paths.derivatives, { schema: 'axp.derivatives.v0', updated_at: new Date().toISOString(), bySymbol });
  return true;
}
export async function loadDerivatives() {
  if (!existsSync(paths.derivatives)) return {};
  try { return readJsonFile(paths.derivatives).bySymbol || {}; } catch { return {}; }
}

// Decision track-record predictions (self-scored). Rolling JSON window in both modes.
export async function loadPredictions() {
  return readCollection(paths.predictions, 'predictions');
}
export async function savePredictions(list = []) {
  writeCollection(paths.predictions, 'predictions', list.slice(-5000));
  return list.length;
}

// --- Decision API credits (REAL money — persisted in Postgres when available) ---
const creditOwner = (o) => String(o || '').toLowerCase();
function loadCreditsJson() {
  if (!existsSync(paths.credits)) return { schema: 'axp.credits.v0', balances: {}, ledger: [], keys: {} };
  try { const j = readJsonFile(paths.credits); return { balances: j.balances || {}, ledger: j.ledger || [], keys: j.keys || {} }; }
  catch { return { balances: {}, ledger: [], keys: {} }; }
}
function saveCreditsJson(store) {
  writeJsonAtomic(paths.credits, { schema: 'axp.credits.v0', updated_at: new Date().toISOString(), balances: store.balances, ledger: store.ledger.slice(-5000), keys: store.keys || {} });
}
const saveCreditsJsonFull = saveCreditsJson;

export async function getCreditBalance(owner) {
  const o = creditOwner(owner);
  if (storageMode() === 'postgres') {
    const r = await query('select balance_usd from credits where owner = $1', [o]);
    return r.rows.length ? Number(r.rows[0].balance_usd) : 0;
  }
  return Number(loadCreditsJson().balances[o] || 0);
}

export async function creditTxUsed(ref) {
  if (!ref) return false;
  if (storageMode() === 'postgres') {
    const r = await query("select 1 from credit_ledger where ref = $1 and type = 'topup' limit 1", [ref]);
    return r.rows.length > 0;
  }
  return loadCreditsJson().ledger.some((e) => e.ref === ref && e.type === 'topup');
}

export async function addCredit(owner, usd, { source = null, ref = null, data = {} } = {}) {
  const o = creditOwner(owner); const amount = Number(usd);
  if (!(amount > 0)) return { ok: false, error: 'invalid_amount' };
  if (storageMode() === 'postgres') {
    if (ref && await creditTxUsed(ref)) return { ok: false, error: 'already_credited' };
    const r = await query(
      `insert into credits (owner, balance_usd) values ($1, $2)
       on conflict (owner) do update set balance_usd = credits.balance_usd + $2, updated_at = now()
       returning balance_usd`, [o, amount]);
    await query('insert into credit_ledger (owner, usd, type, source, ref, data) values ($1,$2,$3,$4,$5,$6::jsonb)',
      [o, amount, 'topup', source, ref, JSON.stringify(data)]);
    return { ok: true, balance: Number(r.rows[0].balance_usd) };
  }
  const store = loadCreditsJson();
  if (ref && store.ledger.some((e) => e.ref === ref && e.type === 'topup')) return { ok: false, error: 'already_credited' };
  store.balances[o] = Number(store.balances[o] || 0) + amount;
  store.ledger.push({ owner: o, usd: amount, type: 'topup', source, ref, at: new Date().toISOString() });
  saveCreditsJson(store);
  return { ok: true, balance: store.balances[o] };
}

// Atomic spend: only succeeds if balance covers it.
export async function spendCredit(owner, usd, { ref = null } = {}) {
  const o = creditOwner(owner); const amount = Number(usd);
  if (!(amount > 0)) return { ok: false, error: 'invalid_amount' };
  if (storageMode() === 'postgres') {
    const r = await query('update credits set balance_usd = balance_usd - $2, updated_at = now() where owner = $1 and balance_usd >= $2 returning balance_usd', [o, amount]);
    if (!r.rows.length) return { ok: false, error: 'insufficient_credits' };
    await query('insert into credit_ledger (owner, usd, type, ref) values ($1,$2,$3,$4)', [o, -amount, 'spend', ref]);
    return { ok: true, balance: Number(r.rows[0].balance_usd) };
  }
  const store = loadCreditsJson();
  const bal = Number(store.balances[o] || 0);
  if (bal < amount) return { ok: false, error: 'insufficient_credits' };
  store.balances[o] = bal - amount;
  store.ledger.push({ owner: o, usd: -amount, type: 'spend', ref, at: new Date().toISOString() });
  saveCreditsJson(store);
  return { ok: true, balance: store.balances[o] };
}

// --- Deribit bot credentials, ENCRYPTED at rest (AES-256-GCM) ---
export function keyVaultEnabled(env = process.env) { return Boolean(env.AXP_KEY_ENC_SECRET); }
function encKey(env = process.env) {
  if (!env.AXP_KEY_ENC_SECRET) return null;
  return createHash('sha256').update(String(env.AXP_KEY_ENC_SECRET)).digest(); // 32 bytes
}
function encryptJson(obj, env = process.env) {
  const key = encKey(env); if (!key) throw new Error('key_vault_disabled');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}
function decryptJson(enc, env = process.env) {
  const key = encKey(env); if (!key) return null;
  try {
    const [ivh, tagh, cth] = String(enc).split(':');
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(ivh, 'hex'));
    d.setAuthTag(Buffer.from(tagh, 'hex'));
    const pt = Buffer.concat([d.update(Buffer.from(cth, 'hex')), d.final()]);
    return JSON.parse(pt.toString('utf8'));
  } catch { return null; }
}

export async function saveDeribitCreds(owner, { apiKey, secret, testnet = true, label = null } = {}) {
  const o = creditOwner(owner);
  const enc = encryptJson({ apiKey, secret }); // throws if vault disabled
  if (storageMode() === 'postgres') {
    await query(
      `insert into deribit_creds (owner, enc, testnet, label) values ($1,$2,$3,$4)
       on conflict (owner) do update set enc=excluded.enc, testnet=excluded.testnet, label=excluded.label, updated_at=now()`,
      [o, enc, Boolean(testnet), label]);
    return { ok: true };
  }
  const store = existsSync(paths.deribitCreds) ? (readJsonFile(paths.deribitCreds).creds || {}) : {};
  store[o] = { enc, testnet: Boolean(testnet), label, updated_at: new Date().toISOString() };
  writeJsonAtomic(paths.deribitCreds, { schema: 'axp.deribit_creds.v0', creds: store });
  return { ok: true };
}

export async function loadDeribitCreds(owner) {
  const o = creditOwner(owner);
  let row = null;
  if (storageMode() === 'postgres') {
    const r = await query('select enc, testnet from deribit_creds where owner=$1', [o]);
    row = r.rows[0] || null;
  } else if (existsSync(paths.deribitCreds)) {
    row = (readJsonFile(paths.deribitCreds).creds || {})[o] || null;
  }
  if (!row) return null;
  const dec = decryptJson(row.enc);
  if (!dec) return null;
  return { apiKey: dec.apiKey, secret: dec.secret, testnet: Boolean(row.testnet) };
}

export async function deribitConnected(owner) {
  const o = creditOwner(owner);
  if (storageMode() === 'postgres') {
    const r = await query('select 1 from deribit_creds where owner=$1 limit 1', [o]);
    return r.rows.length > 0;
  }
  return existsSync(paths.deribitCreds) && Boolean((readJsonFile(paths.deribitCreds).creds || {})[o]);
}

// Credit keys — bearer secrets to spend a wallet's credits (issued at purchase).
export async function issueCreditKey(owner) {
  const o = creditOwner(owner);
  const secret = `axpc_${createHash('sha256').update(`${o}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 40)}`;
  const hash = createHash('sha256').update(secret).digest('hex');
  if (storageMode() === 'postgres') {
    await query('insert into credit_keys (key_hash, owner) values ($1,$2) on conflict (key_hash) do nothing', [hash, o]);
  } else {
    const store = loadCreditsJson(); store.keys = store.keys || {}; store.keys[hash] = o; saveCreditsJsonFull(store);
  }
  return secret;
}
export async function resolveCreditKey(secret) {
  if (!secret) return null;
  const hash = createHash('sha256').update(String(secret)).digest('hex');
  if (storageMode() === 'postgres') {
    const r = await query('select owner from credit_keys where key_hash = $1', [hash]);
    return r.rows.length ? r.rows[0].owner : null;
  }
  return (loadCreditsJson().keys || {})[hash] || null;
}

// Patch a single agent's record (e.g. hosting status) in the registry.
export async function updateAgentFields(agentId, patch) {
  const registry = await loadAgentsRegistry();
  const idx = registry.agents.findIndex((a) => a.agent_id === agentId);
  if (idx < 0) return null;
  const updated = { ...registry.agents[idx], ...patch };
  const agents = [...registry.agents];
  agents[idx] = updated;
  await saveAgentsRegistry({ ...registry, agents });
  return updated;
}

function readCollection(path, key) {
  if (!existsSync(path)) {
    return [];
  }
  try {
    const parsed = readJsonFile(path);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed && Array.isArray(parsed[key])) {
      return parsed[key];
    }
    return [];
  } catch {
    return [];
  }
}

function writeCollection(path, key, items) {
  writeJsonAtomic(path, {
    schema: `axp.${key}.v0`,
    updated_at: new Date().toISOString(),
    count: items.length,
    [key]: items,
  });
}

function writeJsonAtomic(path, payload) {
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`);
  renameSync(tempPath, path);
}

function createEmptyContractStore() {
  return {
    schema: 'axp.contract_store.v0',
    updated_at: null,
    contracts: [],
  };
}

function latestUpdatedAt(items) {
  const timestamps = items
    .map((item) => Date.parse(item.updated_at ?? item.created_at ?? item.registered_at ?? item.prepared_at ?? ''))
    .filter(Number.isFinite);
  if (timestamps.length === 0) {
    return null;
  }

  return new Date(Math.max(...timestamps)).toISOString();
}

function addWhere(clauses, params, column, value) {
  if (value === undefined || value === null || value === '') {
    return;
  }

  params.push(value);
  clauses.push(`${column} = $${params.length}`);
}

function normalizeLimit(value, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }

  return Math.min(Math.trunc(number), 500);
}

function formatLedgerRow(row) {
  const formatted = {
    ...row,
    value_usd: row.value_usd === undefined ? undefined : Number(row.value_usd),
  };

  return {
    ...formatted,
    event_hash: createLedgerHash(formatted),
  };
}

function formatAnchorRow(row) {
  return {
    ...row,
    id: Number(row.id),
    from_event_id: Number(row.from_event_id),
    to_event_id: Number(row.to_event_id),
    event_count: Number(row.event_count),
    chain_id: row.chain_id === null || row.chain_id === undefined ? null : Number(row.chain_id),
    block_number: row.block_number === null || row.block_number === undefined ? null : Number(row.block_number),
  };
}

function createLedgerHash(event) {
  const payload = {
    id: event.id ?? null,
    event_type: event.event_type ?? event.usage_type ?? null,
    agent_id: event.agent_id ?? null,
    counterparty_id: event.counterparty_id ?? null,
    contract_id: event.contract_id ?? null,
    key_id: event.key_id ?? null,
    path: event.path ?? null,
    value_usd: event.value_usd ?? null,
    data: event.data ?? null,
    created_at: event.created_at ?? null,
  };

  return `axp_${createHash('sha256').update(stableStringify(payload)).digest('hex')}`;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`;
}

async function query(text, params = []) {
  const pool = await getPool();
  return pool.query(text, params);
}

async function getPool() {
  if (!poolPromise) {
    poolPromise = createPool();
  }

  return poolPromise;
}

async function createPool() {
  const { Pool } = await import('pg');
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: shouldUseSsl() ? { rejectUnauthorized: false } : undefined,
  });
}

function shouldUseSsl() {
  if (process.env.PGSSLMODE === 'disable') {
    return false;
  }

  return !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '');
}
