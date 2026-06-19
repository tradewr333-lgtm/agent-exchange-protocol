export const ECONOMIC_MODEL_VERSION = '0.2.0';
export const PROTOCOL_FEE_BPS = 50;
export const PROTOCOL_FEE_RATE = PROTOCOL_FEE_BPS / 10_000;

export const ACCEPTED_COLLATERAL = [
  {
    symbol: 'BNB',
    network: 'BNB Smart Chain',
    chain_id: 56,
    type: 'native',
    status: 'planned_onchain',
  },
  {
    symbol: 'WBNB',
    network: 'BNB Smart Chain',
    chain_id: 56,
    type: 'bep20',
    address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    status: 'planned_onchain',
  },
  {
    symbol: 'USDT',
    network: 'BNB Smart Chain',
    chain_id: 56,
    type: 'bep20',
    status: 'planned_onchain',
  },
  {
    symbol: 'USDC',
    network: 'BNB Smart Chain',
    chain_id: 56,
    type: 'bep20',
    status: 'planned_onchain',
  },
];

export function getEconomicPolicy() {
  return {
    protocol: 'AXP',
    economic_model_version: ECONOMIC_MODEL_VERSION,
    principle: 'Universal collateral for adoption; AXP as reputation and capacity accelerator.',
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
      ceiling_bps: PROTOCOL_FEE_BPS,
      ceiling_change_requires_governance: true,
      charged_on: 'prepared_contract_value',
    },
    capacity_formula: 'Capacity = Universal Collateral USD * Reputation Multiplier * AXP Trust Multiplier * Insurance Multiplier * Risk Adjustment',
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
