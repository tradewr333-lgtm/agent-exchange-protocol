import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAgentEconomicProfile, getEconomicPolicy } from './economics.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const registryPath = join(currentDir, '..', 'data', 'agents.json');

export function readJsonFile(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

export function loadRegistry() {
  return readJsonFile(registryPath);
}

export function listAgents(filters = {}) {
  const registry = loadRegistry();
  let agents = registry.agents.map(withEconomicProfile);

  if (filters.status) {
    agents = agents.filter((agent) => agent.status === filters.status);
  }

  if (filters.service) {
    agents = agents.filter((agent) => agent.services.includes(filters.service));
  }

  if (filters.minCapacity !== undefined) {
    agents = agents.filter((agent) => agent.available_capacity >= filters.minCapacity);
  }

  return {
    schema: registry.schema,
    network: registry.network,
    updated_at: registry.updated_at,
    count: agents.length,
    agents,
  };
}

export function getAgent(agentId) {
  const registry = loadRegistry();
  const agent = registry.agents.find((item) => item.agent_id === agentId);
  return agent ? withEconomicProfile(agent) : null;
}

export function getCapabilities() {
  return {
    protocol: 'AXP',
    version: '0.1.0',
    economic_model: getEconomicPolicy(),
    capabilities: [
      'agent_identity',
      'agent_registration',
      'reputation_staking',
      'universal_collateral',
      'multi_asset_collateral_accounting',
      'capacity_score',
      'proof_of_trust',
      'trust_score',
      'trust_ranking',
      'axp_trust_multiplier',
      'agent_contracts',
      'tokenized_slashing',
      'protocol_fee_ceiling',
      'agent_discovery',
      'registry_query',
      'contract_quote',
      'contract_prepare',
      'contract_lookup',
      'contract_settlement',
      'simulated_slashing_signal',
      'agent_operator_signature_auth',
    ],
    query_parameters: {
      '/agents': ['status', 'service', 'min_capacity'],
      'POST /agents/register': ['agent_id', 'name', 'operator', 'services', 'collateral', 'auth'],
      '/agents/{agent_id}': ['agent_id'],
      '/agents/{agent_id}/trust-score': ['agent_id'],
      '/economics': [],
      '/trust-ranking': ['status', 'service', 'min_score', 'limit'],
      'POST /auth/message': ['action', 'agent_id', 'address', 'nonce', 'issued_at', 'scope'],
      'POST /contracts/quote': ['provider_agent_id', 'service', 'requested_capacity'],
      'POST /contracts/prepare': ['provider_agent_id', 'service', 'requested_capacity'],
      '/contracts': [],
      '/contracts/{contract_id}': ['contract_id'],
      'POST /contracts/{contract_id}/settle': ['outcome', 'evidence_uri', 'notes', 'reported_by'],
    },
  };
}

function withEconomicProfile(agent) {
  const economicProfile = getAgentEconomicProfile(agent);
  return {
    ...agent,
    collateral: economicProfile.collateral,
    collateral_usd: economicProfile.collateral_usd,
    axp_reputation_bond: economicProfile.axp_reputation_bond,
    axp_trust_multiplier: economicProfile.axp_trust_multiplier,
    total_capacity: economicProfile.total_capacity,
    available_capacity: economicProfile.available_capacity,
    economic_model: {
      version: '0.2.0',
      capacity_formula: 'Collateral_USD * ReputationMultiplier * AXPTrustMultiplier * InsuranceMultiplier * RiskAdjustment',
      protocol_fee_bps: 50,
    },
  };
}
