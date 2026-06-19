import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAgent } from './registry.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const contractsPath = join(currentDir, '..', 'data', 'contracts.json');

export function quoteContract(payload = {}) {
  const validation = validateContractPayload(payload);
  if (!validation.ok) {
    return validation;
  }

  const provider = getAgent(payload.provider_agent_id);
  if (!provider) {
    return { ok: false, status: 404, error: 'provider_agent_not_found' };
  }

  const requestedCapacity = Number(payload.requested_capacity);
  const service = String(payload.service);
  const serviceSupported = provider.services.includes(service);
  const capacityAvailable = provider.available_capacity >= requestedCapacity;
  const providerActive = provider.status === 'active';
  const obligationAccepted = providerActive && serviceSupported && capacityAvailable;
  const capacityAfter = Math.max(provider.available_capacity - requestedCapacity, 0);
  const riskAdjustment = calculateRiskAdjustment(provider);

  return {
    ok: true,
    status: 200,
    quote: {
      protocol: 'AXP',
      version: '0.1.0',
      quote_id: buildQuoteId(payload, provider),
      requester_agent_id: payload.requester_agent_id ?? null,
      provider_agent_id: provider.agent_id,
      service,
      requested_capacity: requestedCapacity,
      provider_status: provider.status,
      provider_reputation: provider.reputation,
      provider_stake_axp: provider.stake_axp,
      provider_available_capacity: provider.available_capacity,
      capacity_after_prepare: capacityAfter,
      service_supported: serviceSupported,
      capacity_available: capacityAvailable,
      obligation_accepted: obligationAccepted,
      risk_adjustment: riskAdjustment,
      failure_rate: provider.failure_rate,
      settlement_asset: 'AXP',
      evidence: {
        discovery_url: 'https://registry.axp.network/agents',
        provider_metadata_url: `https://registry.axp.network/agents/${provider.agent_id}`,
      },
      reason: getQuoteReason({ providerActive, serviceSupported, capacityAvailable }),
    },
  };
}

export function prepareContract(payload = {}) {
  const quoteResult = quoteContract(payload);
  if (!quoteResult.ok) {
    return quoteResult;
  }

  const quote = quoteResult.quote;
  if (!quote.obligation_accepted) {
    return {
      ok: false,
      status: 409,
      error: 'obligation_not_accepted',
      quote,
    };
  }

  const contractId = `axp_contract_${randomUUID()}`;
  const contract = {
    contract_id: contractId,
    protocol: 'AXP',
    version: '0.1.0',
    status: 'prepared',
    prepared_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    quote,
    terms: {
      service: quote.service,
      requested_capacity: quote.requested_capacity,
      settlement_asset: 'AXP',
      slashable: true,
      arbitration_status: 'planned',
      insurance_status: 'planned',
    },
  };

  savePreparedContract(contract);

  return {
    ok: true,
    status: 201,
    contract,
  };
}

export function getPreparedContract(contractId) {
  return loadContractStore().contracts.find((contract) => contract.contract_id === contractId) ?? null;
}

export function listPreparedContracts() {
  const store = loadContractStore();
  return {
    schema: store.schema,
    updated_at: store.updated_at,
    count: store.contracts.length,
    contracts: store.contracts,
  };
}

function validateContractPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, status: 400, error: 'invalid_json_body' };
  }

  if (!payload.provider_agent_id) {
    return { ok: false, status: 400, error: 'provider_agent_id_required' };
  }

  if (!payload.service) {
    return { ok: false, status: 400, error: 'service_required' };
  }

  const requestedCapacity = Number(payload.requested_capacity);
  if (!Number.isFinite(requestedCapacity) || requestedCapacity <= 0) {
    return { ok: false, status: 400, error: 'requested_capacity_must_be_positive' };
  }

  return { ok: true };
}

function loadContractStore() {
  if (!existsSync(contractsPath)) {
    return createEmptyContractStore();
  }

  try {
    const store = JSON.parse(readFileSync(contractsPath, 'utf8').replace(/^\uFEFF/, ''));
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

function savePreparedContract(contract) {
  const store = loadContractStore();
  const nextStore = {
    schema: 'axp.contract_store.v0',
    updated_at: new Date().toISOString(),
    contracts: [
      ...store.contracts.filter((item) => item.contract_id !== contract.contract_id),
      contract,
    ],
  };

  const tempPath = `${contractsPath}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(nextStore, null, 2)}\n`);
  renameSync(tempPath, contractsPath);
}

function createEmptyContractStore() {
  return {
    schema: 'axp.contract_store.v0',
    updated_at: null,
    contracts: [],
  };
}

function calculateRiskAdjustment(provider) {
  const failurePenalty = Math.min(Number(provider.failure_rate) || 0, 1);
  return Number((1 - failurePenalty).toFixed(4));
}

function buildQuoteId(payload, provider) {
  const source = JSON.stringify({
    requester_agent_id: payload.requester_agent_id ?? null,
    provider_agent_id: provider.agent_id,
    service: payload.service,
    requested_capacity: Number(payload.requested_capacity),
    stake_axp: provider.stake_axp,
    available_capacity: provider.available_capacity,
  });

  return `axp_quote_${createHash('sha256').update(source).digest('hex').slice(0, 16)}`;
}

function getQuoteReason({ providerActive, serviceSupported, capacityAvailable }) {
  if (!providerActive) {
    return 'provider_not_active';
  }

  if (!serviceSupported) {
    return 'service_not_supported';
  }

  if (!capacityAvailable) {
    return 'insufficient_capacity';
  }

  return 'capacity_available';
}
