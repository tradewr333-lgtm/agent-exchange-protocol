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
  const requiredCollateral = normalizeRequiredCollateral(payload, requestedCapacity);
  const service = String(payload.service);
  const economicProfile = getAgentEconomicProfile(provider);
  const serviceSupported = provider.services.includes(service);
  const capacityAvailable = economicProfile.available_capacity >= requiredCollateral;
  const providerActive = provider.status === 'active';
  const obligationAccepted = providerActive && serviceSupported && capacityAvailable;
  const capacityAfter = Math.max(economicProfile.available_capacity - requiredCollateral, 0);
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
      contract_value_usd: requestedCapacity,
      required_provider_collateral_usd: requiredCollateral,
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
      escrow_model: {
        requester_deposits_payment: true,
        provider_locks_collateral: true,
        provider_collateral_usd: requiredCollateral,
        provider_payout_if_settled_usd: round(requestedCapacity - protocolFee.fee_amount),
        requester_refund_if_failed_usd: requestedCapacity,
        slashing_status: 'simulated_until_onchain_escrow_enabled',
      },
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
      escrow_status: 'awaiting_funding',
      requester_payment_required_usd: quote.contract_value_usd,
      required_provider_collateral_usd: quote.required_provider_collateral_usd,
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

export async function fundContract(contractId, payload = {}) {
  const store = await loadContractStore();
  const contract = store.contracts.find((item) => item.contract_id === contractId);
  if (!contract) {
    return { ok: false, status: 404, error: 'contract_not_found', contract_id: contractId };
  }

  if (contract.status !== 'prepared') {
    return { ok: false, status: 409, error: 'contract_must_be_prepared_before_funding', contract };
  }

  const requesterAgentId = contract.quote.requester_agent_id;
  if (!requesterAgentId) {
    return { ok: false, status: 409, error: 'requester_agent_required_for_escrow_funding', contract_id: contractId };
  }

  const authResult = await verifyAgentAuth({
    action: 'contracts.fund',
    agentId: requesterAgentId,
    auth: payload.auth,
    scope: buildFundingScope(contractId),
  });
  if (!authResult.ok) {
    return authResult;
  }

  const paymentAsset = normalizePaymentAsset(payload.payment_asset ?? payload.asset ?? 'USDC');
  if (!paymentAsset.ok) {
    return paymentAsset;
  }

  const fundedAt = new Date().toISOString();
  const valueUsd = Number(contract.quote.contract_value_usd ?? contract.quote.requested_capacity);
  const protocolFee = contract.quote.protocol_fee ?? calculateProtocolFee(valueUsd);
  const updatedContract = {
    ...contract,
    status: 'funded',
    funded_at: fundedAt,
    escrow: {
      status: 'funded',
      mode: 'offchain_simulated_escrow',
      requester_agent_id: requesterAgentId,
      provider_agent_id: contract.quote.provider_agent_id,
      payment_asset: paymentAsset.asset,
      payment_amount_usd: valueUsd,
      protocol_fee_usd: protocolFee.fee_amount,
      protocol_fee_recipient: protocolFee.recipient_address,
      provider_payout_if_settled_usd: round(valueUsd - protocolFee.fee_amount),
      requester_refund_if_failed_usd: valueUsd,
      provider_collateral_required_usd: Number(contract.quote.required_provider_collateral_usd ?? valueUsd * 0.3),
      collateral_status: 'awaiting_provider_acceptance',
      funded_by: requesterAgentId,
      signer: authResult.signer,
      nonce: authResult.auth.nonce,
      issued_at: authResult.auth.issued_at,
      scope: buildFundingScope(contractId),
      funded_at: fundedAt,
    },
  };

  await saveContractStore({
    ...store,
    updated_at: fundedAt,
    contracts: store.contracts.map((item) => (item.contract_id === contractId ? updatedContract : item)),
  });

  await appendTrustEvent({
    event_type: 'contract_funded',
    agent_id: requesterAgentId,
    counterparty_id: contract.quote.provider_agent_id,
    contract_id: contractId,
    value_usd: valueUsd,
    data: updatedContract.escrow,
  });

  return { ok: true, status: 200, contract: updatedContract };
}

export async function acceptContract(contractId, payload = {}) {
  const store = await loadContractStore();
  const contract = store.contracts.find((item) => item.contract_id === contractId);
  if (!contract) {
    return { ok: false, status: 404, error: 'contract_not_found', contract_id: contractId };
  }

  if (contract.status !== 'funded') {
    return { ok: false, status: 409, error: 'contract_must_be_funded_before_acceptance', contract };
  }

  const providerAgentId = contract.quote.provider_agent_id;
  const authResult = await verifyAgentAuth({
    action: 'contracts.accept',
    agentId: providerAgentId,
    auth: payload.auth,
    scope: buildAcceptanceScope(contractId),
  });
  if (!authResult.ok) {
    return authResult;
  }

  const provider = await getAgent(providerAgentId);
  const economicProfile = provider ? getAgentEconomicProfile(provider) : null;
  const collateralRequired = Number(contract.escrow?.provider_collateral_required_usd ?? contract.quote.required_provider_collateral_usd ?? 0);
  if (!economicProfile || economicProfile.available_capacity < collateralRequired) {
    return {
      ok: false,
      status: 409,
      error: 'insufficient_provider_capacity_for_collateral',
      required_collateral_usd: collateralRequired,
      available_capacity_usd: economicProfile?.available_capacity ?? 0,
    };
  }

  const acceptedAt = new Date().toISOString();
  const updatedContract = {
    ...contract,
    status: 'active',
    accepted_at: acceptedAt,
    escrow: {
      ...contract.escrow,
      status: 'active',
      collateral_status: 'locked_simulated',
      accepted_by: providerAgentId,
      provider_signer: authResult.signer,
      provider_nonce: authResult.auth.nonce,
      provider_issued_at: authResult.auth.issued_at,
      provider_scope: buildAcceptanceScope(contractId),
      accepted_at: acceptedAt,
    },
  };

  await saveContractStore({
    ...store,
    updated_at: acceptedAt,
    contracts: store.contracts.map((item) => (item.contract_id === contractId ? updatedContract : item)),
  });

  await appendTrustEvent({
    event_type: 'contract_accepted',
    agent_id: providerAgentId,
    counterparty_id: contract.quote.requester_agent_id,
    contract_id: contractId,
    value_usd: collateralRequired,
    data: updatedContract.escrow,
  });

  return { ok: true, status: 200, contract: updatedContract };
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
      escrow_result: buildEscrowResult(contract, outcome),
    },
    escrow: {
      ...(contract.escrow ?? {}),
      status: outcome === 'settled' ? 'released' : 'refunded_with_slashing_signal',
      result: buildEscrowResult(contract, outcome),
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

function buildFundingScope(contractId) {
  return `contract:${contractId}|fund:true`;
}

function buildAcceptanceScope(contractId) {
  return `contract:${contractId}|accept:true`;
}

function buildSettlementScope(contractId, outcome) {
  return `contract:${contractId}|outcome:${outcome}`;
}

function buildEscrowResult(contract, outcome) {
  const valueUsd = Number(contract.quote?.contract_value_usd ?? contract.quote?.requested_capacity ?? 0);
  const protocolFee = Number(contract.quote?.protocol_fee?.fee_amount ?? calculateProtocolFee(valueUsd).fee_amount);
  const providerPayout = round(valueUsd - protocolFee);
  const collateralRequired = Number(contract.quote?.required_provider_collateral_usd ?? valueUsd * 0.3);
  const slashAmount = round(collateralRequired * 0.3);

  if (outcome === 'settled') {
    return {
      mode: 'offchain_simulated_escrow',
      requester_refund_usd: 0,
      provider_payout_usd: providerPayout,
      protocol_fee_usd: protocolFee,
      provider_collateral_unlocked_usd: collateralRequired,
      provider_collateral_slashed_usd: 0,
    };
  }

  return {
    mode: 'offchain_simulated_escrow',
    requester_refund_usd: valueUsd,
    provider_payout_usd: 0,
    protocol_fee_usd: 0,
    provider_collateral_unlocked_usd: round(Math.max(collateralRequired - slashAmount, 0)),
    provider_collateral_slashed_usd: slashAmount,
  };
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

function normalizeRequiredCollateral(payload, contractValue) {
  const raw = payload.required_collateral_usd ?? payload.required_collateral ?? payload.provider_collateral_usd;
  const value = raw === undefined ? contractValue * 0.3 : Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return round(contractValue * 0.3);
  }

  return round(value);
}

function normalizePaymentAsset(value) {
  const asset = String(value ?? '').toUpperCase();
  if (['BNB', 'USDT', 'USDC'].includes(asset)) {
    return { ok: true, asset };
  }

  return {
    ok: false,
    status: 400,
    error: 'payment_asset_must_be_bnb_usdt_or_usdc',
    accepted_assets: ['BNB', 'USDT', 'USDC'],
  };
}

function round(value) {
  return Math.round(Number(value ?? 0) * 1000000) / 1000000;
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
