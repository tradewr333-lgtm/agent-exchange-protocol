const defaultRegistryUrl = 'https://registry.axp.network';

export class AxpClient {
  constructor(options = {}) {
    this.registryUrl = (options.registryUrl ?? defaultRegistryUrl).replace(/\/$/, '');
    this.fetch = options.fetch ?? globalThis.fetch;
    this.apiKey = options.apiKey ?? (typeof process !== 'undefined' ? process.env?.AXP_API_KEY : undefined);

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

  getEconomics() {
    return this.getJson('/economics');
  }

  async discoverAgentManifest(input) {
    const manifestUrl = resolveAgentManifestUrl(input);
    const response = await this.fetch(manifestUrl, {
      headers: { accept: 'application/json' },
    });
    const manifest = await readJsonResponse(response, manifestUrl);
    return {
      schema: 'axp.agent_manifest_discovery.v0',
      manifest_url: manifestUrl,
      agent_id: manifest.agent_id ?? null,
      axp_trust: manifest.trust?.provider === 'AXP' ? manifest.trust : null,
      manifest,
    };
  }

  verifyAgentManifest(input) {
    requireFields(input, []);
    return this.postJson('/agents/verify-manifest', input, { skipApiKey: true });
  }

  getTrustRanking(filters = {}) {
    return this.getJson(`/trust-ranking${toQuery({
      status: filters.status,
      service: filters.service,
      min_score: filters.minScore ?? filters.min_score,
      limit: filters.limit,
      online: filters.online,
    })}`);
  }

  findAgents(filters = {}) {
    return this.getJson(`/agents${toQuery({
      status: filters.status,
      service: filters.service,
      min_capacity: filters.minCapacity ?? filters.min_capacity,
      online: filters.online,
    })}`);
  }

  registerAgent(input) {
    requireFields(input, ['agent_id', 'name', 'operator', 'services', 'collateral', 'auth']);
    return this.postJson('/agents/register', input);
  }

  registerApiKey(input) {
    requireFields(input, ['name', 'owner', 'auth']);
    return this.postJson('/api-keys/register', input, { skipApiKey: true });
  }

  getApiKey(keyId) {
    requireValue(keyId, 'keyId');
    return this.getJson(`/api-keys/${encodeURIComponent(keyId)}`, { skipApiKey: true });
  }

  rotateApiKey(keyId, input) {
    requireValue(keyId, 'keyId');
    requireFields(input, ['auth']);
    return this.postJson(`/api-keys/${encodeURIComponent(keyId)}/rotate`, input, { skipApiKey: true });
  }

  sendHeartbeat(agentId, input) {
    requireValue(agentId, 'agentId');
    requireFields(input, ['status', 'available', 'current_load', 'available_capacity', 'auth']);
    return this.postJson(`/agents/${encodeURIComponent(agentId)}/heartbeat`, input);
  }

  getAgentProfile(agentId) {
    requireValue(agentId, 'agentId');
    return this.getJson(`/agents/${encodeURIComponent(agentId)}`);
  }

  getTrustScore(agentId) {
    requireValue(agentId, 'agentId');
    return this.getJson(`/trust-score/${encodeURIComponent(agentId)}`);
  }

  getRiskReport(agentId) {
    requireValue(agentId, 'agentId');
    return this.getJson(`/risk-report/${encodeURIComponent(agentId)}`);
  }

  getBestAgent(filters = {}) {
    return this.getJson(`/best-agent${toQuery({
      task: filters.task,
      service: filters.service,
      requested_capacity: filters.requestedCapacity ?? filters.requested_capacity,
      limit: filters.limit,
      online: filters.online,
    })}`);
  }

  getAgentPassport(agentId) {
    requireValue(agentId, 'agentId');
    return this.getJson(`/passport/${encodeURIComponent(agentId)}`);
  }

  performHandshake(input) {
    requireFields(input, ['counterparty_agent_id']);
    return this.postJson('/handshake', input);
  }

  listTrustAnchors(filters = {}) {
    return this.getJson(`/anchors${toQuery({
      status: filters.status,
      limit: filters.limit,
    })}`);
  }

  getLatestTrustAnchor() {
    return this.getJson('/anchors/latest');
  }

  prepareTrustAnchor(input = {}) {
    return this.postJson('/anchors/prepare', input);
  }

  recordTrustAnchor(input = {}) {
    requireFields(input, ['batch_id', 'merkle_root', 'tx_hash']);
    return this.postJson('/anchors/record', input);
  }

  async getCapacityScore(agentId) {
    const agent = await this.getAgentProfile(agentId);
    return {
      agent_id: agent.agent_id,
      reputation: agent.reputation,
      stake_axp: agent.stake_axp,
      collateral: agent.collateral,
      collateral_usd: agent.collateral_usd,
      axp_reputation_bond: agent.axp_reputation_bond,
      axp_trust_multiplier: agent.axp_trust_multiplier,
      total_capacity: agent.total_capacity,
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

  async getJson(path, options = {}) {
    const response = await this.fetch(`${this.registryUrl}${path}`, {
      headers: this.buildHeaders(options),
    });
    return readJsonResponse(response, path);
  }

  async postJson(path, body, options = {}) {
    const response = await this.fetch(`${this.registryUrl}${path}`, {
      method: 'POST',
      headers: this.buildHeaders(options),
      body: JSON.stringify(body),
    });

    return readJsonResponse(response, path);
  }

  buildHeaders(options = {}) {
    const headers = {
      'content-type': 'application/json',
    };

    if (!options.skipApiKey && this.apiKey) {
      headers['x-axp-api-key'] = this.apiKey;
    }

    return headers;
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

export function buildRegistrationScope({
  agentId,
  operator,
  services,
  collateral,
  manifestUrl,
}) {
  requireValue(agentId, 'agentId');
  requireValue(operator, 'operator');
  if (!Array.isArray(services) || services.length === 0) {
    throw new Error('services are required');
  }
  if (!collateral || typeof collateral !== 'object') {
    throw new Error('collateral is required');
  }

  const asset = String(collateral.asset ?? collateral.symbol ?? '').toUpperCase();
  const amount = Number(collateral.amount);
  return [
    `agent:${agentId}`,
    `operator:${operator}`,
    `services:${services.join(',')}`,
    `collateral:${asset}:${amount}`,
    `manifest:${manifestUrl ?? 'none'}`,
  ].join('|');
}

export function buildApiKeyRegistrationScope({
  name,
  owner,
  agentId,
  framework,
}) {
  requireValue(name, 'name');
  requireValue(owner, 'owner');
  return [
    `api_key:${name}`,
    `owner:${owner}`,
    `agent:${agentId ?? 'none'}`,
    `framework:${framework ?? 'none'}`,
  ].join('|');
}

export function buildApiKeyRotationScope({
  keyId,
  owner,
}) {
  requireValue(keyId, 'keyId');
  requireValue(owner, 'owner');
  return `api_key:${keyId}|owner:${owner}|rotate:true`;
}

export function buildHeartbeatScope({
  agentId,
  status,
  available,
  currentLoad,
  availableCapacity,
  endpoint,
}) {
  requireValue(agentId, 'agentId');
  return [
    `agent:${agentId}`,
    `status:${status}`,
    `available:${Boolean(available)}`,
    `load:${Number(currentLoad)}`,
    `capacity:${Number(availableCapacity)}`,
    `endpoint:${endpoint ?? 'none'}`,
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

function resolveAgentManifestUrl(input) {
  if (typeof input === 'string') {
    if (input.startsWith('https://')) {
      return input;
    }

    return `https://${input.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}/.well-known/agent.json`;
  }

  if (input?.manifestUrl || input?.manifest_url || input?.url) {
    return input.manifestUrl ?? input.manifest_url ?? input.url;
  }

  if (input?.domain) {
    return `https://${String(input.domain).replace(/^https?:\/\//, '').replace(/\/.*$/, '')}/.well-known/agent.json`;
  }

  throw new Error('domain or manifestUrl is required');
}
