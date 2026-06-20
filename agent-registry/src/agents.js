import { renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyOperatorAuth } from './auth.js';
import { ACCEPTED_COLLATERAL } from './economics.js';
import { loadRegistry } from './registry.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const registryPath = join(currentDir, '..', 'data', 'agents.json');
const AGENT_ID_PATTERN = /^[a-zA-Z0-9_-]{3,64}$/;
const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const HEARTBEAT_WINDOW_MS = 5 * 60 * 1000;

export async function registerAgent(payload = {}) {
  const validation = validateRegistrationPayload(payload);
  if (!validation.ok) {
    return validation;
  }

  const registry = loadRegistry();
  const existingAgent = registry.agents.find((agent) => agent.agent_id === payload.agent_id);
  if (existingAgent) {
    return {
      ok: false,
      status: 409,
      error: 'agent_already_registered',
      agent_id: payload.agent_id,
    };
  }

  const scope = buildRegistrationScope(payload);
  const authResult = await verifyOperatorAuth({
    action: 'agents.register',
    agentId: payload.agent_id,
    operator: payload.operator,
    auth: payload.auth,
    scope,
  });
  if (!authResult.ok) {
    return authResult;
  }

  const agent = createRegisteredAgent(payload, authResult, scope);
  const updatedRegistry = saveRegistry({
    ...registry,
    agents: [...registry.agents, agent],
  });

  return {
    ok: true,
    status: 201,
    agent,
    registry: {
      schema: updatedRegistry.schema,
      network: updatedRegistry.network,
      updated_at: updatedRegistry.updated_at,
      count: updatedRegistry.agents.length,
    },
  };
}

export function buildRegistrationScope(payload) {
  const services = normalizeServices(payload.services).join(',');
  const collateral = normalizeCollateral(payload.collateral);
  return [
    `agent:${payload.agent_id}`,
    `operator:${payload.operator}`,
    `services:${services}`,
    `collateral:${collateral.symbol}:${collateral.amount}`,
    `manifest:${payload.manifest_url ?? 'none'}`,
  ].join('|');
}

export async function updateAgentHeartbeat(agentId, payload = {}) {
  const validation = validateHeartbeatPayload(payload);
  if (!validation.ok) {
    return validation;
  }

  const registry = loadRegistry();
  const agent = registry.agents.find((item) => item.agent_id === agentId);
  if (!agent) {
    return { ok: false, status: 404, error: 'agent_not_found', agent_id: agentId };
  }

  const scope = buildHeartbeatScope(agentId, payload);
  const authResult = await verifyOperatorAuth({
    action: 'agents.heartbeat',
    agentId,
    operator: agent?.manifest?.onchain?.operator,
    auth: payload.auth,
    scope,
  });
  if (!authResult.ok) {
    return authResult;
  }

  const now = new Date().toISOString();
  const updatedAgent = {
    ...agent,
    status: payload.status,
    available_capacity: round(payload.available_capacity ?? agent.available_capacity ?? 0),
    heartbeat: {
      status: payload.status,
      available: Boolean(payload.available),
      current_load: round(payload.current_load),
      available_capacity: round(payload.available_capacity),
      endpoint: payload.endpoint ?? null,
      version: payload.version ?? null,
      last_seen_at: now,
      expires_at: new Date(Date.now() + HEARTBEAT_WINDOW_MS).toISOString(),
      signer: authResult.signer,
      nonce: authResult.auth.nonce,
      issued_at: authResult.auth.issued_at,
      scope,
    },
  };

  const updatedRegistry = saveRegistry({
    ...registry,
    agents: registry.agents.map((item) => (item.agent_id === agentId ? updatedAgent : item)),
  });

  return {
    ok: true,
    status: 200,
    agent: updatedAgent,
    registry: {
      schema: updatedRegistry.schema,
      network: updatedRegistry.network,
      updated_at: updatedRegistry.updated_at,
      count: updatedRegistry.agents.length,
    },
  };
}

export function buildHeartbeatScope(agentId, payload) {
  return [
    `agent:${agentId}`,
    `status:${payload.status}`,
    `available:${Boolean(payload.available)}`,
    `load:${Number(payload.current_load)}`,
    `capacity:${Number(payload.available_capacity)}`,
    `endpoint:${payload.endpoint ?? 'none'}`,
  ].join('|');
}

export function recordAgentContractOutcome({ agentId, outcome, volumeUsd, counterpartyId }) {
  const registry = loadRegistry();
  const agent = registry.agents.find((item) => item.agent_id === agentId);
  if (!agent) {
    return { ok: false, status: 404, error: 'agent_not_found', agent_id: agentId };
  }

  const completedContracts = Number(agent.completed_contracts ?? 0) + (outcome === 'settled' ? 1 : 0);
  const failedContracts = Number(agent.failed_contracts ?? 0) + (outcome === 'failed' ? 1 : 0);
  const totalContracts = completedContracts + failedContracts;
  const trustMetrics = agent.trust_metrics ?? {};
  const counterparties = new Set(Array.isArray(agent.counterparties) ? agent.counterparties : []);
  if (counterpartyId) {
    counterparties.add(counterpartyId);
  }

  const updatedAgent = {
    ...agent,
    completed_contracts: completedContracts,
    failed_contracts: failedContracts,
    failure_rate: totalContracts > 0 ? round(failedContracts / totalContracts) : 0,
    counterparties: [...counterparties],
    trust_metrics: {
      ...trustMetrics,
      settled_volume_usd: round(Number(trustMetrics.settled_volume_usd ?? 0) + (outcome === 'settled' ? volumeUsd : 0)),
      failed_volume_usd: round(Number(trustMetrics.failed_volume_usd ?? 0) + (outcome === 'failed' ? volumeUsd : 0)),
      success_rate: totalContracts > 0 ? round(completedContracts / totalContracts) : 0,
      counterparty_diversity: counterparties.size,
      time_weight: Math.max(1, Number(trustMetrics.time_weight ?? 1)),
      disputes_lost: Number(trustMetrics.disputes_lost ?? 0),
      late_delivery_penalties: Number(trustMetrics.late_delivery_penalties ?? 0),
      slashing_events: Number(trustMetrics.slashing_events ?? 0) + (outcome === 'failed' ? 1 : 0),
      fraud_flags: Number(trustMetrics.fraud_flags ?? 0),
    },
  };

  const updatedRegistry = saveRegistry({
    ...registry,
    agents: registry.agents.map((item) => (item.agent_id === agentId ? updatedAgent : item)),
  });

  return {
    ok: true,
    status: 200,
    agent: updatedAgent,
    registry: {
      schema: updatedRegistry.schema,
      network: updatedRegistry.network,
      updated_at: updatedRegistry.updated_at,
      count: updatedRegistry.agents.length,
    },
  };
}

function createRegisteredAgent(payload, authResult, scope) {
  const collateral = normalizeCollateral(payload.collateral);
  const now = new Date().toISOString();

  return {
    agent_id: payload.agent_id,
    name: payload.name,
    role: payload.role ?? 'provider',
    status: 'active',
    services: normalizeServices(payload.services),
    reputation: 1,
    stake_axp: Number(payload.stake_axp ?? 0),
    collateral: {
      accounting_unit: 'USD',
      status: 'self_reported_pending_onchain_verification',
      assets: [
        {
          symbol: collateral.symbol,
          network: 'BNB Smart Chain',
          chain_id: 56,
          address: collateral.address,
          amount: collateral.amount,
          usd_value: collateral.usdValue,
          role: 'primary_collateral',
          pricing_status: collateral.symbol === 'BNB' ? 'oracle_pending' : 'stablecoin_parity',
        },
      ],
      total_usd: collateral.usdValue,
    },
    available_capacity: collateral.usdValue,
    completed_contracts: 0,
    failed_contracts: 0,
    failure_rate: 0,
    trust_metrics: {
      settled_volume_usd: 0,
      success_rate: 0,
      counterparty_diversity: 0,
      time_weight: 1,
      failed_volume_usd: 0,
      disputes_lost: 0,
      late_delivery_penalties: 0,
      slashing_events: 0,
      fraud_flags: 0,
    },
    registered_at: now,
    heartbeat: {
      status: 'active',
      available: true,
      current_load: 0,
      available_capacity: collateral.usdValue,
      endpoint: payload.endpoint ?? null,
      version: payload.version ?? null,
      last_seen_at: now,
      expires_at: new Date(Date.now() + HEARTBEAT_WINDOW_MS).toISOString(),
      signer: authResult.signer,
      nonce: authResult.auth.nonce,
      issued_at: authResult.auth.issued_at,
      scope: 'registration_bootstrap',
    },
    registration: {
      method: 'api_signed_operator',
      action: 'agents.register',
      signer: authResult.signer,
      nonce: authResult.auth.nonce,
      issued_at: authResult.auth.issued_at,
      scope,
      collateral_verification: 'pending_onchain_attestation',
    },
    manifest: {
      protocol: 'AXP',
      version: '0.1.0',
      identity: `axp:registry:${payload.agent_id}`,
      manifest_url: payload.manifest_url ?? null,
      onchain: {
        network: 'BNB Smart Chain',
        chain_id: 56,
        operator: payload.operator,
      },
    },
  };
}

function validateRegistrationPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, status: 400, error: 'invalid_json_body' };
  }

  if (!payload.agent_id || typeof payload.agent_id !== 'string' || !AGENT_ID_PATTERN.test(payload.agent_id)) {
    return { ok: false, status: 400, error: 'agent_id_invalid' };
  }

  if (!payload.name || typeof payload.name !== 'string' || payload.name.length > 120) {
    return { ok: false, status: 400, error: 'name_required' };
  }

  if (!payload.operator || typeof payload.operator !== 'string' || !ADDRESS_PATTERN.test(payload.operator)) {
    return { ok: false, status: 400, error: 'operator_invalid' };
  }

  if (normalizeServices(payload.services).length === 0) {
    return { ok: false, status: 400, error: 'services_required' };
  }

  if (payload.manifest_url !== undefined && typeof payload.manifest_url !== 'string') {
    return { ok: false, status: 400, error: 'manifest_url_invalid' };
  }

  try {
    normalizeCollateral(payload.collateral);
  } catch (error) {
    return { ok: false, status: 400, error: error.message };
  }

  return { ok: true };
}

function validateHeartbeatPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, status: 400, error: 'invalid_json_body' };
  }

  if (!['active', 'paused', 'offline'].includes(payload.status)) {
    return { ok: false, status: 400, error: 'status_must_be_active_paused_or_offline' };
  }

  if (typeof payload.available !== 'boolean') {
    return { ok: false, status: 400, error: 'available_must_be_boolean' };
  }

  const currentLoad = Number(payload.current_load);
  if (!Number.isFinite(currentLoad) || currentLoad < 0 || currentLoad > 1) {
    return { ok: false, status: 400, error: 'current_load_must_be_between_0_and_1' };
  }

  const availableCapacity = Number(payload.available_capacity);
  if (!Number.isFinite(availableCapacity) || availableCapacity < 0) {
    return { ok: false, status: 400, error: 'available_capacity_must_be_non_negative' };
  }

  if (payload.endpoint !== undefined && typeof payload.endpoint !== 'string') {
    return { ok: false, status: 400, error: 'endpoint_invalid' };
  }

  if (payload.version !== undefined && typeof payload.version !== 'string') {
    return { ok: false, status: 400, error: 'version_invalid' };
  }

  return { ok: true };
}

function normalizeServices(services) {
  if (!Array.isArray(services)) {
    return [];
  }

  return [...new Set(services
    .map((service) => String(service).trim())
    .filter((service) => /^[a-zA-Z0-9_-]{2,64}$/.test(service)))];
}

function normalizeCollateral(collateral) {
  if (!collateral || typeof collateral !== 'object') {
    throw new Error('collateral_required');
  }

  const symbol = String(collateral.asset ?? collateral.symbol ?? '').toUpperCase();
  const accepted = ACCEPTED_COLLATERAL.find((asset) => asset.symbol === symbol);
  if (!accepted) {
    throw new Error('collateral_asset_not_supported');
  }

  const amount = Number(collateral.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('collateral_amount_must_be_positive');
  }

  const explicitUsdValue = Number(collateral.usd_value);
  const usdValue = Number.isFinite(explicitUsdValue) && explicitUsdValue > 0 ? explicitUsdValue : amount;

  return {
    symbol,
    amount: round(amount),
    usdValue: round(usdValue),
    address: accepted.address ?? null,
  };
}

function saveRegistry(registry) {
  const updatedRegistry = {
    ...registry,
    updated_at: new Date().toISOString(),
  };
  const tempPath = `${registryPath}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(updatedRegistry, null, 2)}\n`);
  renameSync(tempPath, registryPath);
  return updatedRegistry;
}

function round(value) {
  return Number(Number(value).toFixed(6));
}
