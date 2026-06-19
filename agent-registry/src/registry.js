import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  let agents = registry.agents;

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
  return registry.agents.find((agent) => agent.agent_id === agentId) ?? null;
}

export function getCapabilities() {
  return {
    protocol: 'AXP',
    version: '0.1.0',
    capabilities: [
      'agent_identity',
      'reputation_staking',
      'capacity_score',
      'agent_contracts',
      'tokenized_slashing',
      'agent_discovery',
      'registry_query',
      'contract_quote',
      'contract_prepare',
      'contract_lookup',
    ],
    query_parameters: {
      '/agents': ['status', 'service', 'min_capacity'],
      '/agents/{agent_id}': ['agent_id'],
      'POST /contracts/quote': ['provider_agent_id', 'service', 'requested_capacity'],
      'POST /contracts/prepare': ['provider_agent_id', 'service', 'requested_capacity'],
      '/contracts': [],
      '/contracts/{contract_id}': ['contract_id'],
    },
  };
}
