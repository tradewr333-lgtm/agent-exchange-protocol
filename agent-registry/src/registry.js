import { getAgentEconomicProfile, getEconomicPolicy } from './economics.js';
import { loadAgentsRegistry, readJsonFile, storageMode } from './store.js';

export { readJsonFile };

export async function loadRegistry() {
  return loadAgentsRegistry();
}

export async function listAgents(filters = {}) {
  const registry = await loadRegistry();
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

  if (filters.online !== undefined) {
    agents = agents.filter((agent) => agent.online === filters.online);
  }

  return {
    schema: registry.schema,
    network: registry.network,
    updated_at: registry.updated_at,
    count: agents.length,
    agents,
  };
}

export async function getAgent(agentId) {
  const registry = await loadRegistry();
  const agent = registry.agents.find((item) => item.agent_id === agentId);
  return agent ? withEconomicProfile(agent) : null;
}

export function getCapabilities() {
  return {
    protocol: 'AXP',
    version: '0.1.0',
    economic_model: getEconomicPolicy(),
    storage: {
      mode: storageMode(),
      postgres_enabled: storageMode() === 'postgres',
      fallback: 'json',
      schema: 'agent-registry/db/schema.sql',
      tables: [
        'agents',
        'api_keys',
        'heartbeats',
        'contracts',
        'settlements',
        'trust_events',
        'trust_anchors',
        'api_usage',
      ],
      dashboard_endpoint: '/dashboard',
      network_endpoint: '/network',
    },
    api_key_rate_limits: {
      window: 'daily_utc',
      headers: [
        'X-AXP-RateLimit-Limit',
        'X-AXP-RateLimit-Remaining',
        'X-AXP-RateLimit-Reset',
        'X-AXP-RateLimit-Tier',
      ],
      tiers: {
        free_developer: 1000,
        agent: 10000,
        verified_agent: 100000,
        partner: 'custom',
      },
      upgrade_policy: 'verified_agent and partner are controlled upgrades; public self-registration defaults to free_developer or agent.',
    },
    capabilities: [
      'agent_identity',
      'agent_registration',
      'agent_heartbeat',
      'api_key_identity',
      'api_key_usage_metering',
      'api_key_rate_limiting',
      'api_key_daily_tiers',
      'postgres_persistence',
      'json_fallback_storage',
      'agent_manifest_discovery',
      'agent_manifest_verification',
      'counterparty_trust_discovery',
      'agent_passport',
      'agent_passport_score',
      'axp_handshake_protocol',
      'contract_prepare_advisory_handshake',
      'contract_prepare_enforced_handshake',
      'agent_trust_firewall',
      'scout_agent_blueprint',
      'trust_event_ledger',
      'trust_event_query',
      'api_usage_query',
      'operator_dashboard',
      'proof_of_trust_network_visualization',
      'cryptographic_trust_event_hashes',
      'merkle_trust_anchors',
      'bsc_trust_anchor_ready',
      'trust_oracle',
      'trust_api',
      'reputation_staking',
      'universal_collateral',
      'multi_asset_collateral_accounting',
      'capacity_score',
      'proof_of_trust',
      'trust_score',
      'risk_report',
      'trust_ranking',
      'best_agent_recommendation',
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
      'POST /api-keys/register': ['name', 'owner', 'agent_id', 'framework', 'tier', 'daily_limit', 'auth'],
      '/api-keys/{key_id}': ['key_id'],
      'POST /api-keys/{key_id}/rotate': ['auth'],
      '/agents': ['status', 'service', 'min_capacity', 'online'],
      'POST /agents/register': ['agent_id', 'name', 'operator', 'services', 'collateral', 'auth'],
      'POST /agents/verify-manifest': ['manifest_url', 'domain', 'agent_id'],
      '/agents/{agent_id}': ['agent_id'],
      '/agents/{agent_id}/passport': ['agent_id'],
      'POST /agents/{agent_id}/heartbeat': ['status', 'available', 'current_load', 'available_capacity', 'endpoint', 'auth'],
      '/agents/{agent_id}/trust-score': ['agent_id'],
      '/passport/{agent_id}': ['agent_id'],
      'POST /handshake': ['requester_agent_id', 'counterparty_agent_id', 'policy'],
      '/trust-score/{agent_id}': ['agent_id'],
      '/risk-report/{agent_id}': ['agent_id'],
      '/economics': [],
      '/trust-ranking': ['status', 'service', 'min_score', 'limit', 'online'],
      '/trust-events': ['agent_id', 'event_type', 'contract_id', 'counterparty_id', 'limit'],
      '/agents/{agent_id}/trust-events': ['agent_id', 'event_type', 'contract_id', 'counterparty_id', 'limit'],
      '/api-usage': ['key_id', 'usage_type', 'agent_id', 'path', 'limit'],
      '/anchors': ['status', 'limit'],
      '/anchors/latest': [],
      'POST /anchors/prepare': ['limit', 'after_event_id', 'chain_id', 'contract_address', 'registry_url'],
      'POST /anchors/record': ['batch_id', 'merkle_root', 'tx_hash', 'chain_id', 'contract_address', 'block_number'],
      '/dashboard': [],
      '/network': [],
      '/best-agent': ['task', 'service', 'requested_capacity', 'limit', 'online'],
      'POST /auth/message': ['action', 'agent_id', 'address', 'nonce', 'issued_at', 'scope'],
      'POST /contracts/quote': ['provider_agent_id', 'service', 'requested_capacity'],
      'POST /contracts/prepare': ['provider_agent_id', 'service', 'requested_capacity', 'handshake_mode', 'trust_policy'],
      '/contracts': [],
      '/contracts/{contract_id}': ['contract_id'],
      'POST /contracts/{contract_id}/settle': ['outcome', 'evidence_uri', 'notes', 'reported_by'],
    },
  };
}

function withEconomicProfile(agent) {
  const economicProfile = getAgentEconomicProfile(agent);
  const heartbeat = agent.heartbeat ?? null;
  const online = heartbeat?.available === true && Date.parse(heartbeat.expires_at ?? '') > Date.now();
  return {
    ...agent,
    heartbeat,
    online,
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
