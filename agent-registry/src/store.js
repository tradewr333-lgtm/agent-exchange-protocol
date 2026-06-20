import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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
