import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Wallet } from 'ethers';

const registryBaseUrl = process.env.AXP_REGISTRY_URL ?? 'https://registry.axp.network';
const requesterAgentId = process.env.AXP_REQUESTER_AGENT_ID ?? 'agent_0001';
const providerAgentId = process.env.AXP_PROVIDER_AGENT_ID ?? 'agent_0002';
const service = process.env.AXP_SERVICE ?? 'research';
const requestedCapacity = Number(process.env.AXP_REQUESTED_CAPACITY ?? '100');

const privateKey = getPrivateKey();

if (!privateKey) {
  throw new Error('Set AXP_AGENT_PRIVATE_KEY or configure blockchain/.env with the agent operator key.');
}

const wallet = new Wallet(privateKey);
const issuedAt = new Date().toISOString();
const nonce = `prepare-${Date.now()}`;
const scope = [
  `provider:${providerAgentId}`,
  `requester:${requesterAgentId}`,
  `service:${service}`,
  `capacity:${requestedCapacity}`,
].join('|');

const messageResponse = await postJson('/auth/message', {
  action: 'contracts.prepare',
  agent_id: providerAgentId,
  address: wallet.address,
  nonce,
  issued_at: issuedAt,
  scope,
});

const signature = await wallet.signMessage(messageResponse.message);

const preparedContract = await postJson('/contracts/prepare', {
  requester_agent_id: requesterAgentId,
  provider_agent_id: providerAgentId,
  service,
  requested_capacity: requestedCapacity,
  auth: {
    agent_id: providerAgentId,
    address: wallet.address,
    nonce,
    issued_at: issuedAt,
    signature,
  },
});

console.log(JSON.stringify({
  ok: true,
  registry: registryBaseUrl,
  signer: wallet.address,
  contract_id: preparedContract.contract_id,
  status: preparedContract.status,
  provider_agent_id: preparedContract.quote.provider_agent_id,
  requested_capacity: preparedContract.quote.requested_capacity,
  lookup_url: `${registryBaseUrl}/contracts/${preparedContract.contract_id}`,
}, null, 2));

async function postJson(path, body) {
  const response = await fetch(`${registryBaseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${path} failed: ${JSON.stringify(payload)}`);
  }

  return payload;
}

function getPrivateKey() {
  if (process.env.AXP_AGENT_PRIVATE_KEY) {
    return process.env.AXP_AGENT_PRIVATE_KEY.trim();
  }

  const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  const localEnvPath = join(repoRoot, 'blockchain', '.env');

  try {
    const env = readFileSync(localEnvPath, 'utf8');
    return (
      env.match(/^BSC_MAINNET_PRIVATE_KEY=(.+)$/m)?.[1]
      ?? env.match(/^BSC_TESTNET_PRIVATE_KEY=(.+)$/m)?.[1]
      ?? ''
    ).trim();
  } catch {
    return '';
  }
}
