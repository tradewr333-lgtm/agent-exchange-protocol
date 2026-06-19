import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyAgentAuth } from './auth.js';
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

  const authResult = verifyAgentAuth({
    action: 'contracts.prepare',
    agentId: payload.provider_agent_id,
    auth: payload.auth,
    scope: buildPrepareScope(payload),
  });
  if (!authResult.ok) {
    return authResult;
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
    authorization: {
      action: 'contracts.prepare',
      agent_id: authResult.auth.agent_id,
      signer: authResult.signer,
      nonce: authResult.auth.nonce,
      issued_at: authResult.auth.issued_at,
      scope: buildPrepareScope(payload),
    },
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

export function settleContract(contractId, payload = {}) {
  const validation = validateSettlementPayload(payload);
  if (!validation.ok) {
    return validation;
  }

  const store = loadContractStore();
  const contract = store.contracts.find((item) => item.contract_id === contractId);
  if (!contract) {
    return { ok: false, status: 404, error: 'contract_not_found', contract_id: contractId };
  }

  if (['settled', 'failed'].includes(contract.status)) {
    return {
      ok: false,
      status: 409,
      error: 'contract_already_finalized',
      contract,
    };
  }

  const authAgentId = payload?.auth?.agent_id;
  if (![contract.quote.requester_agent_id, contract.quote.provider_agent_id].includes(authAgentId)) {
    return { ok: false, status: 401, error: 'auth_agent_not_contract_party' };
  }

  const authResult = verifyAgentAuth({
    action: 'contracts.settle',
    agentId: authAgentId,
    auth: payload.auth,
    scope: buildSettlementScope(contractId, payload.outcome),
  });
  if (!authResult.ok) {
    return authResult;
  }

  const outcome = payload.outcome;
  const settledAt = new Date().toISOString();
  const updatedContract = {
    ...contract,
    status: outcome,
    settled_at: settledAt,
    settlement: {
      outcome,
      evidence_uri: payload.evidence_uri ?? null,
      notes: payload.notes ?? null,
      reported_by: authAgentId,
      signer: authResult.signer,
      nonce: authResult.auth.nonce,
      issued_at: authResult.auth.issued_at,
      scope: buildSettlementScope(contractId, outcome),
      simulated: true,
      onchain_slashing_status: outcome === 'failed' ? 'pending_connection' : 'not_required',
      slashable: outcome === 'failed',
    },
  };

  saveContractStore({
    ...store,
    updated_at: settledAt,
    contracts: store.contracts.map((item) => (
      item.contract_id === contractId ? updatedContract : item
    )),
  });

  return {
    ok: true,
    status: 200,
    contract: updatedContract,
  };
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

function buildPrepareScope(payload) {
  return [
    `provider:${payload.provider_agent_id}`,
    `requester:${payload.requester_agent_id ?? 'none'}`,
    `service:${payload.service}`,
    `capacity:${Number(payload.requested_capacity)}`,
  ].join('|');
}

function buildSettlementScope(contractId, outcome) {
  return `contract:${contractId}|outcome:${outcome}`;
}

function validateSettlementPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, status: 400, error: 'invalid_json_body' };
  }

  if (!['settled', 'failed'].includes(payload.outcome)) {
    return { ok: false, status: 400, error: 'outcome_must_be_settled_or_failed' };
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
  saveContractStore({
    schema: 'axp.contract_store.v0',
    updated_at: new Date().toISOString(),
    contracts: [
      ...store.contracts.filter((item) => item.contract_id !== contract.contract_id),
      contract,
    ],
  });
}

function saveContractStore(store) {
  const tempPath = `${contractsPath}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(store, null, 2)}\n`);
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
