export const ECONOMIC_MODEL_VERSION = '0.2.0';
export const PROTOCOL_FEE_BPS = 50;
export const PROTOCOL_FEE_RATE = PROTOCOL_FEE_BPS / 10_000;
export const PROTOCOL_FEE_RECIPIENT_BSC = '0x4c182480c3559A15311FdeB075C1d7af9D4D8854';

export const ACCEPTED_COLLATERAL = [
  {
    symbol: 'BNB',
    network: 'BNB Smart Chain',
    chain_id: 56,
    type: 'native',
    role: 'network_gas_and_native_collateral',
    status: 'planned_onchain',
  },
  {
    symbol: 'USDT',
    network: 'BNB Smart Chain',
    chain_id: 56,
    type: 'bep20',
    address: '0x55d398326f99059ff775485246999027b3197955',
    role: 'stablecoin_collateral',
    status: 'planned_onchain',
  },
  {
    symbol: 'USDC',
    network: 'BNB Smart Chain',
    chain_id: 56,
    type: 'bep20',
    address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
    role: 'stablecoin_collateral',
    status: 'planned_onchain',
  },
];

export function getEconomicPolicy() {
  return {
    protocol: 'AXP',
    economic_model_version: ECONOMIC_MODEL_VERSION,
    principle: 'BNB, USDT, and USDC as operational collateral; AXP as reputation and capacity accelerator.',
    accepted_collateral: ACCEPTED_COLLATERAL,
    collateral_accounting_unit: 'USD',
    native_token_role: {
      token: 'AXP',
      role: 'reputation_bond_governance_capacity_multiplier',
      not_required_for_entry: true,
      initial_staking_yield: false,
    },
    protocol_fee: {
      base_fee_bps: PROTOCOL_FEE_BPS,
      base_fee_percent: 0.5,
      recipient_network: 'BNB Smart Chain',
      recipient_address: PROTOCOL_FEE_RECIPIENT_BSC,
      ceiling_bps: PROTOCOL_FEE_BPS,
      ceiling_change_requires_governance: true,
      charged_on: 'prepared_contract_value',
    },
    capacity_formula: 'Capacity = BNB/USDT/USDC Collateral USD * Reputation Multiplier * AXP Trust Multiplier * Insurance Multiplier * Risk Adjustment',
    proof_of_trust: {
      status: 'specification',
      score_formula: 'Trust Score = Trust Created - Trust Destroyed',
      trust_created_inputs: ['settled_volume_usd', 'success_rate', 'counterparty_diversity', 'time_weight'],
      trust_destroyed_inputs: ['failed_volume_usd', 'disputes_lost', 'late_delivery_penalties', 'slashing_events'],
      purpose: 'Measure economically verified trust created by agents without relying on ratings or subjective stars.',
    },
  };
}

export function getAgentEconomicProfile(agent) {
  const collateral = agent.collateral ?? createLegacyCollateral(agent);
  const collateralUsd = Number(collateral.total_usd ?? 0);
  const axpStake = Number(agent.stake_axp ?? 0);
  const reputationMultiplier = Number(agent.reputation ?? 1);
  const axpTrustMultiplier = calculateAxpTrustMultiplier(axpStake, collateralUsd);
  const riskAdjustment = calculateRiskAdjustment(agent);
  const insuranceMultiplier = Number(agent.insurance_multiplier ?? 1);
  const totalCapacity = collateralUsd * reputationMultiplier * axpTrustMultiplier * insuranceMultiplier * riskAdjustment;
  const activeObligations = Number(agent.active_obligations ?? 0);
  const pendingDisputeExposure = Number(agent.pending_dispute_exposure ?? 0);
  const availableCapacity = Math.max(totalCapacity - activeObligations - pendingDisputeExposure, 0);

  return {
    collateral,
    collateral_usd: roundUsd(collateralUsd),
    axp_reputation_bond: axpStake,
    reputation_multiplier: reputationMultiplier,
    axp_trust_multiplier: axpTrustMultiplier,
    insurance_multiplier: insuranceMultiplier,
    risk_adjustment: riskAdjustment,
    total_capacity: roundUsd(totalCapacity),
    active_obligations: roundUsd(activeObligations),
    pending_dispute_exposure: roundUsd(pendingDisputeExposure),
    available_capacity: roundUsd(availableCapacity),
  };
}

export function calculateProtocolFee(contractValue) {
  const value = Number(contractValue);
  return {
    fee_bps: PROTOCOL_FEE_BPS,
    fee_percent: 0.5,
    fee_amount_usd: Number.isFinite(value) ? roundUsd(value * PROTOCOL_FEE_RATE) : 0,
    settlement_asset: 'collateral_asset_or_usd_equivalent',
    recipient_network: 'BNB Smart Chain',
    recipient_address: PROTOCOL_FEE_RECIPIENT_BSC,
  };
}

export function calculateRiskAdjustment(agent) {
  const failurePenalty = Math.min(Number(agent.failure_rate) || 0, 1);
  return Number((1 - failurePenalty).toFixed(4));
}

function calculateAxpTrustMultiplier(axpStake, collateralUsd) {
  if (axpStake <= 0 || collateralUsd <= 0) {
    return 1;
  }

  const ratio = axpStake / collateralUsd;
  const cappedBoost = Math.min(ratio * 0.5, 1);
  return Number((1 + cappedBoost).toFixed(4));
}

function createLegacyCollateral(agent) {
  return {
    accounting_unit: 'USD',
    status: 'simulated_from_legacy_axp_stake',
    assets: [
      {
        symbol: 'AXP',
        amount: Number(agent.stake_axp ?? 0),
        usd_value: Number(agent.available_capacity ?? agent.stake_axp ?? 0),
        role: 'legacy_reputation_bond',
      },
    ],
    total_usd: Number(agent.available_capacity ?? agent.stake_axp ?? 0),
  };
}

function roundUsd(value) {
  return Number((Number(value) || 0).toFixed(2));
}
