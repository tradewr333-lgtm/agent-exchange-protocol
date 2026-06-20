import { Wallet } from 'ethers';
import {
  AxpClient,
  buildApiKeyRegistrationScope,
  buildHeartbeatScope,
  buildPrepareScope,
  buildRegistrationScope,
  buildSettlementScope,
} from '../../packages/axp-sdk-typescript/src/index.js';

const registryUrl = (process.env.AXP_REGISTRY_URL ?? 'https://registry.axp.network').replace(/\/$/, '');
const providerWallet = getWallet('AXP_PROVIDER_PRIVATE_KEY');
const requesterWallet = getWallet('AXP_REQUESTER_PRIVATE_KEY');
const runId = compactRunId();
const providerAgentId = process.env.AXP_PROVIDER_AGENT_ID ?? `agent_demo_provider_${runId}`;
const requesterAgentId = process.env.AXP_REQUESTER_AGENT_ID ?? `agent_demo_requester_${runId}`;
const service = process.env.AXP_SERVICE ?? 'research';
const requestedCapacity = Number(process.env.AXP_REQUESTED_CAPACITY ?? '100');

const bootstrapClient = new AxpClient({ registryUrl });

console.log('\nAXP full agent onboarding');
console.log('='.repeat(72));
console.log(`Registry: ${registryUrl}`);
console.log(`Provider agent: ${providerAgentId}`);
console.log(`Requester agent: ${requesterAgentId}`);
console.log(`Service: ${service}`);
console.log('');

const apiKey = await createApiKey();
const axp = new AxpClient({ registryUrl, apiKey: apiKey.secret });

await registerProviderAgent(axp);
await registerRequesterAgent(axp);
await sendProviderHeartbeat(axp);
await runTrustChecks(axp);
const contract = await prepareContract(axp);
await settleContract(axp, contract.contract_id);
await showFinalTrustState(axp);

console.log('\nComplete.');
console.log('This is the machine-native AXP path: API Key -> Agent -> Heartbeat -> Risk -> Contract -> Settlement -> Trust.');

async function createApiKey() {
  const name = `full-onboarding-${runId}`;
  const auth = await signAuthorization({
    wallet: providerWallet,
    action: 'api_keys.register',
    agentId: 'api_key',
    scope: buildApiKeyRegistrationScope({
      name,
      owner: providerWallet.address,
      agentId: providerAgentId,
      framework: 'full-agent-onboarding',
    }),
  });

  const result = await bootstrapClient.registerApiKey({
    name,
    owner: providerWallet.address,
    agent_id: providerAgentId,
    framework: 'full-agent-onboarding',
    scopes: ['trust:read', 'agents:read', 'contracts:write'],
    auth,
  });

  printStep('1 API key created', {
    key_id: result.api_key.key_id,
    header: 'X-AXP-API-Key',
    secret_prefix: result.secret.slice(0, 13),
    usage: result.api_key.usage,
  });

  return result;
}

async function registerProviderAgent(axp) {
  const payload = {
    agent_id: providerAgentId,
    name: `AXP Demo Provider ${runId}`,
    operator: providerWallet.address,
    role: 'provider',
    services: [service, 'analysis', 'verified_delivery'],
    collateral: {
      asset: 'USDC',
      amount: 1000,
      usd_value: 1000,
    },
    endpoint: `https://agents.example.com/${providerAgentId}`,
    version: '0.1.0-demo',
  };
  const auth = await signAuthorization({
    wallet: providerWallet,
    action: 'agents.register',
    agentId: providerAgentId,
    scope: buildRegistrationScope({
      agentId: payload.agent_id,
      operator: payload.operator,
      services: payload.services,
      collateral: payload.collateral,
      manifestUrl: payload.manifest_url,
    }),
  });

  const result = await axp.registerAgent({ ...payload, auth });
  printStep('2 Provider registered', {
    agent_id: result.agent_id,
    operator: providerWallet.address,
    collateral_usd: result.collateral.total_usd,
    services: result.services,
  });
}

async function registerRequesterAgent(axp) {
  const payload = {
    agent_id: requesterAgentId,
    name: `AXP Demo Requester ${runId}`,
    operator: requesterWallet.address,
    role: 'requester',
    services: ['task_request', 'counterparty_settlement'],
    collateral: {
      asset: 'USDT',
      amount: 250,
      usd_value: 250,
    },
    endpoint: `https://agents.example.com/${requesterAgentId}`,
    version: '0.1.0-demo',
  };
  const auth = await signAuthorization({
    wallet: requesterWallet,
    action: 'agents.register',
    agentId: requesterAgentId,
    scope: buildRegistrationScope({
      agentId: payload.agent_id,
      operator: payload.operator,
      services: payload.services,
      collateral: payload.collateral,
      manifestUrl: payload.manifest_url,
    }),
  });

  const result = await axp.registerAgent({ ...payload, auth });
  printStep('3 Requester registered', {
    agent_id: result.agent_id,
    operator: requesterWallet.address,
    collateral_usd: result.collateral.total_usd,
  });
}

async function sendProviderHeartbeat(axp) {
  const heartbeat = {
    status: 'active',
    available: true,
    current_load: 0.18,
    available_capacity: 900,
    endpoint: `https://agents.example.com/${providerAgentId}`,
    version: '0.1.0-demo',
  };
  const auth = await signAuthorization({
    wallet: providerWallet,
    action: 'agents.heartbeat',
    agentId: providerAgentId,
    scope: buildHeartbeatScope({
      agentId: providerAgentId,
      status: heartbeat.status,
      available: heartbeat.available,
      currentLoad: heartbeat.current_load,
      availableCapacity: heartbeat.available_capacity,
      endpoint: heartbeat.endpoint,
    }),
  });

  const result = await axp.sendHeartbeat(providerAgentId, { ...heartbeat, auth });
  printStep('4 Heartbeat sent', {
    agent_id: result.agent_id,
    online_hint: true,
    current_load: result.heartbeat.current_load,
    available_capacity: result.heartbeat.available_capacity,
    endpoint: result.heartbeat.endpoint,
  });
}

async function runTrustChecks(axp) {
  const riskReport = await axp.getRiskReport(providerAgentId);
  const bestAgent = await axp.getBestAgent({
    task: service,
    online: true,
    requestedCapacity,
    limit: 3,
  });

  printStep('5 Trust Oracle checks', {
    risk_report: {
      agent_id: riskReport.agent_id,
      risk: riskReport.risk,
      confidence: riskReport.confidence,
      recommended_limit_usd: riskReport.recommended_limit_usd,
    },
    best_agent_top: bestAgent.recommended[0] ?? null,
  });
}

async function prepareContract(axp) {
  const auth = await signAuthorization({
    wallet: providerWallet,
    action: 'contracts.prepare',
    agentId: providerAgentId,
    scope: buildPrepareScope({
      providerAgentId,
      requesterAgentId,
      service,
      requestedCapacity,
    }),
  });

  const contract = await axp.prepareContract({
    requester_agent_id: requesterAgentId,
    provider_agent_id: providerAgentId,
    service,
    requested_capacity: requestedCapacity,
    handshake_mode: 'advisory',
    trust_policy: {
      require_online: false,
      allowed_risk: ['LOW', 'MEDIUM'],
    },
    auth,
  });

  printStep('6 Contract prepared', {
    contract_id: contract.contract_id,
    status: contract.status,
    provider_agent_id: contract.quote.provider_agent_id,
    requester_agent_id: contract.quote.requester_agent_id,
    requested_capacity: contract.quote.requested_capacity,
    protocol_fee: contract.quote.protocol_fee,
    handshake_mode: contract.handshake?.mode,
    handshake: contract.handshake?.result?.handshake,
  });

  return contract;
}

async function settleContract(axp, contractId) {
  const auth = await signAuthorization({
    wallet: providerWallet,
    action: 'contracts.settle',
    agentId: providerAgentId,
    scope: buildSettlementScope({
      contractId,
      outcome: 'settled',
    }),
  });

  const settled = await axp.settleContract(contractId, {
    outcome: 'settled',
    evidence_uri: `https://evidence.example.com/${contractId}`,
    notes: 'Full onboarding example settled successfully.',
    auth,
  });

  printStep('7 Contract settled', {
    contract_id: settled.contract_id,
    status: settled.status,
    reported_by: settled.settlement.reported_by,
    onchain_slashing_status: settled.settlement.onchain_slashing_status,
  });
}

async function showFinalTrustState(axp) {
  const trustScore = await axp.getTrustScore(providerAgentId);
  const ranking = await axp.getTrustRanking({
    service,
    online: true,
    limit: 5,
  });

  printStep('8 Trust state queried', {
    trust_score: {
      agent_id: trustScore.agent_id,
      proof_of_trust_score: trustScore.proof_of_trust_score,
      trust_created: trustScore.trust_created,
      trust_destroyed: trustScore.trust_destroyed,
      online: trustScore.online,
    },
    ranking_count: ranking.count,
    ranking_top: ranking.agents[0] ?? null,
  });
}

async function signAuthorization({ wallet, action, agentId, scope }) {
  const nonce = `${action}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const issuedAt = new Date().toISOString();
  const response = await bootstrapClient.buildAuthMessage({
    action,
    agent_id: agentId,
    address: wallet.address,
    nonce,
    issued_at: issuedAt,
    scope,
  });
  const signature = await wallet.signMessage(response.message);

  return {
    agent_id: agentId,
    address: wallet.address,
    nonce,
    issued_at: issuedAt,
    signature,
  };
}

function printStep(title, payload) {
  console.log(`\n${title}`);
  console.log('-'.repeat(72));
  console.log(JSON.stringify(payload, null, 2));
}

function getWallet(envName) {
  const privateKey = process.env[envName]?.trim();
  if (privateKey) {
    return new Wallet(privateKey);
  }

  return Wallet.createRandom();
}

function compactRunId() {
  return Date.now().toString(36);
}
