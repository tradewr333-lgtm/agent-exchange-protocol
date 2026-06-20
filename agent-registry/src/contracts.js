import { createHash, randomUUID } from 'node:crypto';
import { recordAgentContractOutcome } from './agents.js';
import { verifyAgentAuth } from './auth.js';
import { calculateProtocolFee, getAgentEconomicProfile } from './economics.js';
import { performAxpHandshake } from './passport.js';
import { getAgent } from './registry.js';
import {
  appendSettlementEvent,
  appendTrustEvent,
  loadContractStore,
  saveContractStore,
} from './store.js';

export async function quoteContract(payload = {}) {
  const validation = validateContractPayload(payload);
  if (!validation.ok) {
    return validation;
  }

  const provider = await getAgent(payload.provider_agent_id);
  if (!provider) {
    return { ok: false, status: 404, error: 'provider_agent_not_found' };
  }

  const requestedCapacity = Number(payload.requested_capacity);
  const service = String(payload.service);
  const economicProfile = getAgentEconomicProfile(provider);
  const serviceSupported = provider.services.includes(service);
  const capacityAvailable = economicProfile.available_capacity >= requestedCapacity;
  const providerActive = provider.status === 'active';
  const obligationAccepted = providerActive && serviceSupported && capacityAvailable;
  const capacityAfter = Math.max(economicProfile.available_capacity - requestedCapacity, 0);
  const protocolFee = calculateProtocolFee(requestedCapacity);

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
      provider_collateral_usd: economicProfile.collateral_usd,
      provider_collateral: economicProfile.collateral,
      provider_axp_reputation_bond: economicProfile.axp_reputation_bond,
      provider_axp_trust_multiplier: economicProfile.axp_trust_multiplier,
      provider_total_capacity: economicProfile.total_capacity,
      provider_available_capacity: economicProfile.available_capacity,
      capacity_after_prepare: capacityAfter,
      service_supported: serviceSupported,
      capacity_available: capacityAvailable,
      obligation_accepted: obligationAccepted,
      risk_adjustment: economicProfile.risk_adjustment,
      failure_rate: provider.failure_rate,
      collateral_accounting_unit: 'USD',
      accepted_collateral_assets: ['BNB', 'USDT', 'USDC'],
      axp_required_for_entry: false,
      axp_role: 'reputation_bond_and_capacity_multiplier',
      protocol_fee: protocolFee,
      settlement_asset: payload.settlement_asset ?? 'USD-equivalent collateral',
      evidence: {
        discovery_url: 'https://registry.axp.network/agents',
        provider_metadata_url: `https://registry.axp.network/agents/${provider.agent_id}`,
      },
      reason: getQuoteReason({ providerActive, serviceSupported, capacityAvailable }),
    },
  };
}

export async function prepareContract(payload = {}) {
  const quoteResult = await quoteContract(payload);
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

  const handshakeMode = normalizeHandshakeMode(payload.handshake_mode ?? payload.trust_mode);
  const handshakeResult = await performAxpHandshake({
    requester_agent_id: payload.requester_agent_id,
    counterparty_agent_id: payload.provider_agent_id,
    policy: payload.trust_policy ?? payload.policy,
  });

  if (handshakeMode === 'enforced' && handshakeResult.handshake !== 'ACCEPTED') {
    await appendTrustEvent({
      event_type: 'handshake_rejected',
      agent_id: quote.provider_agent_id,
      counterparty_id: quote.requester_agent_id,
      contract_id: null,
      value_usd: quote.requested_capacity,
      data: {
        mode: handshakeMode,
        quote_id: quote.quote_id,
        handshake: handshakeResult,
      },
    });

    return {
      ok: false,
      status: 409,
      error: 'handshake_policy_rejected',
      mode: handshakeMode,
      quote,
      handshake: handshakeResult,
    };
  }

  const authResult = await verifyAgentAuth({
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
    handshake: {
      mode: handshakeMode,
      advisory: handshakeMode === 'advisory',
      enforced: handshakeMode === 'enforced',
      result: handshakeResult,
    },
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
      collateral_accounting_unit: 'USD',
      accepted_collateral_assets: quote.accepted_collateral_assets,
      protocol_fee: quote.protocol_fee,
      settlement_asset: quote.settlement_asset,
      slashable: true,
      arbitration_status: 'planned',
      insurance_status: 'planned',
    },
  };

  const store = await loadContractStore();
  await saveContractStore({
    schema: 'axp.contract_store.v0',
    updated_at: new Date().toISOString(),
    contracts: [
      ...store.contracts.filter((item) => item.contract_id !== contract.contract_id),
      contract,
    ],
  });
  await appendTrustEvent({
    event_type: 'contract_prepared',
    agent_id: quote.provider_agent_id,
    counterparty_id: quote.requester_agent_id,
    contract_id: contract.contract_id,
    value_usd: quote.requested_capacity,
    data: contract,
  });
  await appendTrustEvent({
    event_type: handshakeResult.handshake === 'ACCEPTED' ? 'handshake_accepted' : 'handshake_rejected',
    agent_id: quote.provider_agent_id,
    counterparty_id: quote.requester_agent_id,
    contract_id: contract.contract_id,
    value_usd: quote.requested_capacity,
    data: {
      mode: handshakeMode,
      advisory: handshakeMode === 'advisory',
      enforced: handshakeMode === 'enforced',
      handshake: handshakeResult,
    },
  });

  return {
    ok: true,
    status: 201,
    contract,
  };
}

export async function getPreparedContract(contractId) {
  const store = await loadContractStore();
  return store.contracts.find((contract) => contract.contract_id === contractId) ?? null;
}

export async function settleContract(contractId, payload = {}) {
  const validation = validateSettlementPayload(payload);
  if (!validation.ok) {
    return validation;
  }

  const store = await loadContractStore();
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

  const authResult = await verifyAgentAuth({
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

  await saveContractStore({
    ...store,
    updated_at: settledAt,
    contracts: store.contracts.map((item) => (
      item.contract_id === contractId ? updatedContract : item
    )),
  });

  await appendSettlementEvent(contractId, updatedContract.settlement);
  await appendTrustEvent({
    event_type: outcome === 'settled' ? 'contract_settled' : 'contract_failed',
    agent_id: contract.quote.provider_agent_id,
    counterparty_id: contract.quote.requester_agent_id,
    contract_id: contractId,
    value_usd: Number(contract.quote.requested_capacity),
    data: updatedContract.settlement,
  });

  const trustUpdate = await recordAgentContractOutcome({
    agentId: contract.quote.provider_agent_id,
    outcome,
    volumeUsd: Number(contract.quote.requested_capacity),
    counterpartyId: contract.quote.requester_agent_id,
    contractId,
  });

  return {
    ok: true,
    status: 200,
    contract: {
      ...updatedContract,
      trust_update: trustUpdate.ok
        ? {
            agent_id: trustUpdate.agent.agent_id,
            completed_contracts: trustUpdate.agent.completed_contracts,
            failed_contracts: trustUpdate.agent.failed_contracts,
            settled_volume_usd: trustUpdate.agent.trust_metrics.settled_volume_usd,
            failed_volume_usd: trustUpdate.agent.trust_metrics.failed_volume_usd,
            success_rate: trustUpdate.agent.trust_metrics.success_rate,
          }
        : trustUpdate,
    },
  };
}

export async function listPreparedContracts() {
  const store = await loadContractStore();
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

function normalizeHandshakeMode(value) {
  const mode = String(value ?? 'advisory').toLowerCase();
  if (mode === 'enforced') {
    return 'enforced';
  }

  return 'advisory';
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

function buildQuoteId(payload, provider) {
  const source = JSON.stringify({
    requester_agent_id: payload.requester_agent_id ?? null,
    provider_agent_id: provider.agent_id,
    service: payload.service,
    requested_capacity: Number(payload.requested_capacity),
    collateral_usd: provider.collateral_usd,
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
