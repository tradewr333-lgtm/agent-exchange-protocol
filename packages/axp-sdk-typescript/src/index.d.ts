export interface AxpClientOptions {
  registryUrl?: string;
  fetch?: typeof fetch;
  apiKey?: string;
}

export interface FindAgentsFilters {
  status?: string;
  service?: string;
  minCapacity?: number;
  min_capacity?: number;
  online?: boolean;
}

export interface TrustRankingFilters {
  status?: string;
  service?: string;
  minScore?: number;
  min_score?: number;
  limit?: number;
  online?: boolean;
}

export interface BestAgentFilters {
  task?: string;
  service?: string;
  requestedCapacity?: number;
  requested_capacity?: number;
  limit?: number;
  online?: boolean;
}

export interface TrustAnchorFilters {
  status?: string;
  limit?: number;
}

export interface HandshakePolicy {
  minimum_score?: number;
  minimum_stake_usd?: number;
  minimum_capacity_usd?: number;
  require_online?: boolean;
  insurance_required?: boolean;
  allowed_risk?: string[];
}

export interface HandshakeInput {
  requester_agent_id?: string;
  counterparty_agent_id: string;
  policy?: HandshakePolicy;
  trust_policy?: HandshakePolicy;
}

export interface PrepareTrustAnchorInput {
  limit?: number;
  after_event_id?: number;
  chain_id?: number;
  contract_address?: string;
  registry_url?: string;
}

export interface RecordTrustAnchorInput {
  batch_id: string;
  merkle_root: string;
  tx_hash: string;
  from_event_id?: number;
  to_event_id?: number;
  event_count?: number;
  chain_id?: number;
  contract_address?: string;
  block_number?: number;
  registry_url?: string;
  batch_uri?: string;
}

export interface ContractQuoteInput {
  requester_agent_id?: string;
  provider_agent_id: string;
  service: string;
  requested_capacity: number;
}

export interface RegisterAgentInput {
  agent_id: string;
  name: string;
  operator: string;
  services: string[];
  collateral: {
    asset?: 'BNB' | 'USDT' | 'USDC';
    symbol?: 'BNB' | 'USDT' | 'USDC';
    amount: number;
    usd_value?: number;
  };
  manifest_url?: string;
  role?: string;
  auth: AgentAuth;
}

export interface HeartbeatInput {
  status: 'active' | 'paused' | 'offline';
  available: boolean;
  current_load: number;
  available_capacity: number;
  endpoint?: string;
  version?: string;
  auth: AgentAuth;
}

export interface AgentAuth {
  agent_id: string;
  address: string;
  nonce: string;
  issued_at: string;
  signature: string;
}

export interface RegisterApiKeyInput {
  name: string;
  owner: string;
  agent_id?: string;
  framework?: string;
  scopes?: string[];
  auth: AgentAuth;
}

export interface PrepareContractInput extends ContractQuoteInput {
  auth: AgentAuth;
  handshake_mode?: 'advisory' | 'enforced';
  trust_policy?: HandshakePolicy;
  policy?: HandshakePolicy;
}

export interface AuthMessageInput {
  action: string;
  agent_id: string;
  address: string;
  nonce: string;
  issued_at: string;
  scope: string;
}

export interface SettleContractInput {
  outcome: 'settled' | 'failed';
  evidence_uri?: string;
  notes?: string;
  auth: AgentAuth;
}

export declare class AxpClient {
  constructor(options?: AxpClientOptions);
  registryUrl: string;
  apiKey?: string;
  getManifest(): Promise<unknown>;
  getCapabilities(): Promise<unknown>;
  getEconomics(): Promise<unknown>;
  getTrustRanking(filters?: TrustRankingFilters): Promise<unknown>;
  findAgents(filters?: FindAgentsFilters): Promise<unknown>;
  registerApiKey(input: RegisterApiKeyInput): Promise<unknown>;
  getApiKey(keyId: string): Promise<unknown>;
  rotateApiKey(keyId: string, input: { auth: AgentAuth }): Promise<unknown>;
  registerAgent(input: RegisterAgentInput): Promise<unknown>;
  sendHeartbeat(agentId: string, input: HeartbeatInput): Promise<unknown>;
  getAgentProfile(agentId: string): Promise<any>;
  getTrustScore(agentId: string): Promise<unknown>;
  getRiskReport(agentId: string): Promise<unknown>;
  getBestAgent(filters?: BestAgentFilters): Promise<unknown>;
  getAgentPassport(agentId: string): Promise<unknown>;
  performHandshake(input: HandshakeInput): Promise<unknown>;
  listTrustAnchors(filters?: TrustAnchorFilters): Promise<unknown>;
  getLatestTrustAnchor(): Promise<unknown>;
  prepareTrustAnchor(input?: PrepareTrustAnchorInput): Promise<unknown>;
  recordTrustAnchor(input: RecordTrustAnchorInput): Promise<unknown>;
  getCapacityScore(agentId: string): Promise<unknown>;
  quoteContract(input: ContractQuoteInput): Promise<unknown>;
  buildAuthMessage(input: AuthMessageInput): Promise<unknown>;
  prepareContract(input: PrepareContractInput): Promise<unknown>;
  listContracts(): Promise<unknown>;
  getContract(contractId: string): Promise<unknown>;
  settleContract(contractId: string, input: SettleContractInput): Promise<unknown>;
}

export declare function createAxpClient(options?: AxpClientOptions): AxpClient;
export declare function buildPrepareScope(input: {
  providerAgentId: string;
  requesterAgentId?: string;
  service: string;
  requestedCapacity: number;
}): string;
export declare function buildRegistrationScope(input: {
  agentId: string;
  operator: string;
  services: string[];
  collateral: {
    asset?: string;
    symbol?: string;
    amount: number;
  };
  manifestUrl?: string;
}): string;
export declare function buildApiKeyRegistrationScope(input: {
  name: string;
  owner: string;
  agentId?: string;
  framework?: string;
}): string;
export declare function buildApiKeyRotationScope(input: {
  keyId: string;
  owner: string;
}): string;
export declare function buildHeartbeatScope(input: {
  agentId: string;
  status: 'active' | 'paused' | 'offline';
  available: boolean;
  currentLoad: number;
  availableCapacity: number;
  endpoint?: string;
}): string;
export declare function buildSettlementScope(input: {
  contractId: string;
  outcome: 'settled' | 'failed';
}): string;
