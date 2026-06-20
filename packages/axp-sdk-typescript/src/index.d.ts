export interface AxpClientOptions {
  registryUrl?: string;
  fetch?: typeof fetch;
}

export interface FindAgentsFilters {
  status?: string;
  service?: string;
  minCapacity?: number;
  min_capacity?: number;
}

export interface TrustRankingFilters {
  status?: string;
  service?: string;
  minScore?: number;
  min_score?: number;
  limit?: number;
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

export interface AgentAuth {
  agent_id: string;
  address: string;
  nonce: string;
  issued_at: string;
  signature: string;
}

export interface PrepareContractInput extends ContractQuoteInput {
  auth: AgentAuth;
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
  getManifest(): Promise<unknown>;
  getCapabilities(): Promise<unknown>;
  getEconomics(): Promise<unknown>;
  getTrustRanking(filters?: TrustRankingFilters): Promise<unknown>;
  findAgents(filters?: FindAgentsFilters): Promise<unknown>;
  registerAgent(input: RegisterAgentInput): Promise<unknown>;
  getAgentProfile(agentId: string): Promise<any>;
  getTrustScore(agentId: string): Promise<unknown>;
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
export declare function buildSettlementScope(input: {
  contractId: string;
  outcome: 'settled' | 'failed';
}): string;
