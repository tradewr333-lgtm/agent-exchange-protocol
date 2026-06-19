const defaultRegistryUrl = 'https://registry.axp.network';

export class AxpClient {
  constructor(options = {}) {
    this.registryUrl = (options.registryUrl ?? defaultRegistryUrl).replace(/\/$/, '');
    this.fetch = options.fetch ?? globalThis.fetch;

    if (!this.fetch) {
      throw new Error('A fetch implementation is required.');
    }
  }

  getManifest() {
    return this.getJson('/.well-known/axp.json');
  }

  getCapabilities() {
    return this.getJson('/capabilities');
  }

  findAgents(filters = {}) {
    return this.getJson(`/agents${toQuery({
      status: filters.status,
      service: filters.service,
      min_capacity: filters.minCapacity ?? filters.min_capacity,
    })}`);
  }

  getAgentProfile(agentId) {
    requireValue(agentId, 'agentId');
    return this.getJson(`/agents/${encodeURIComponent(agentId)}`);
  }

  async getCapacityScore(agentId) {
    const agent = await this.getAgentProfile(agentId);
    return {
      agent_id: agent.agent_id,
      reputation: agent.reputation,
      stake_axp: agent.stake_axp,
      available_capacity: agent.available_capacity,
      completed_contracts: agent.completed_contracts,
      failed_contracts: agent.failed_contracts,
      failure_rate: agent.failure_rate,
    };
  }

  quoteContract(input) {
    requireFields(input, ['provider_agent_id', 'service', 'requested_capacity']);
    return this.postJson('/contracts/quote', input);
  }

  buildAuthMessage(input) {
    requireFields(input, ['action', 'agent_id', 'address', 'nonce', 'issued_at', 'scope']);
    return this.postJson('/auth/message', input);
  }

  prepareContract(input) {
    requireFields(input, ['provider_agent_id', 'service', 'requested_capacity', 'auth']);
    return this.postJson('/contracts/prepare', input);
  }

  listContracts() {
    return this.getJson('/contracts');
  }

  getContract(contractId) {
    requireValue(contractId, 'contractId');
    return this.getJson(`/contracts/${encodeURIComponent(contractId)}`);
  }

  settleContract(contractId, input) {
    requireValue(contractId, 'contractId');
    requireFields(input, ['outcome', 'auth']);
    return this.postJson(`/contracts/${encodeURIComponent(contractId)}/settle`, input);
  }

  async getJson(path) {
    const response = await this.fetch(`${this.registryUrl}${path}`);
    return readJsonResponse(response, path);
  }

  async postJson(path, body) {
    const response = await this.fetch(`${this.registryUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    return readJsonResponse(response, path);
  }
}

export function createAxpClient(options = {}) {
  return new AxpClient(options);
}

export function buildPrepareScope({
  providerAgentId,
  requesterAgentId,
  service,
  requestedCapacity,
}) {
  return [
    `provider:${providerAgentId}`,
    `requester:${requesterAgentId ?? 'none'}`,
    `service:${service}`,
    `capacity:${Number(requestedCapacity)}`,
  ].join('|');
}

export function buildSettlementScope({ contractId, outcome }) {
  return `contract:${contractId}|outcome:${outcome}`;
}

async function readJsonResponse(response, path) {
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${path} failed: ${JSON.stringify(payload)}`);
  }

  return payload;
}

function toQuery(params) {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value));
    }
  }

  const query = search.toString();
  return query ? `?${query}` : '';
}

function requireFields(input, fields) {
  if (!input || typeof input !== 'object') {
    throw new Error('input object is required');
  }

  for (const field of fields) {
    if (input[field] === undefined || input[field] === null || input[field] === '') {
      throw new Error(`${field} is required`);
    }
  }
}

function requireValue(value, name) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`${name} is required`);
  }
}
