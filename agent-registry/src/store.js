import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const dataDir = join(currentDir, '..', 'data');

export const paths = {
  agents: join(dataDir, 'agents.json'),
  apiKeys: join(dataDir, 'api-keys.json'),
  contracts: join(dataDir, 'contracts.json'),
};

let poolPromise = null;

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
