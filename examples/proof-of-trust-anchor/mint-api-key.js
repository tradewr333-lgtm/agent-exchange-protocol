// Mint an AXP API key by signing a wallet message (EIP-191). The /anchors/* endpoints
// are gated by an API key; this issues one for your operator wallet. The private key
// is read locally and only used to sign — it is never sent to the registry.
//
// Usage (from repo root, with blockchain/.env holding your key):
//   AXP_REGISTRY_URL=https://axp.network node examples/proof-of-trust-anchor/mint-api-key.js
import { ethers } from 'ethers';
import { randomBytes } from 'node:crypto';
import { loadBlockchainEnv } from './load-env.js';
import { buildAuthMessage } from '../../agent-registry/src/auth.js';
import { buildApiKeyScope } from '../../agent-registry/src/api-keys.js';

loadBlockchainEnv();

const registryUrl = (process.env.AXP_REGISTRY_URL ?? 'https://axp.network').replace(/\/$/, '');
const KEY_NAMES = [
  'AXP_OPERATOR_KEY', 'BSC_MAINNET_PRIVATE_KEY', 'BSC_TESTNET_PRIVATE_KEY',
  'PRIVATE_KEY', 'DEPLOYER_PRIVATE_KEY', 'BSC_PRIVATE_KEY', 'OPERATOR_PRIVATE_KEY',
];
let rawKey = KEY_NAMES.map((name) => process.env[name]).find((value) => value && value.trim());
if (!rawKey) {
  console.error('Missing operator key. Set one of:', KEY_NAMES.join(', '), 'in blockchain/.env or inline.');
  process.exit(1);
}
rawKey = rawKey.trim();
if (!rawKey.startsWith('0x')) rawKey = '0x' + rawKey;

const wallet = new ethers.Wallet(rawKey);
const owner = wallet.address;
const name = process.env.AXP_KEY_NAME ?? 'axp-anchor-key';

const payload = { name, owner };
const scope = buildApiKeyScope(payload);
const nonce = '0x' + randomBytes(16).toString('hex');
const issued_at = new Date().toISOString();
const message = buildAuthMessage({ action: 'api_keys.register', agentId: owner, address: owner, nonce, issuedAt: issued_at, scope });
const signature = await wallet.signMessage(message);

const res = await fetch(`${registryUrl}/api-keys/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name, owner, auth: { agent_id: owner, address: owner, signature, nonce, issued_at } }),
});
const json = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error('api-key register failed:', JSON.stringify(json));
  process.exit(1);
}

console.log(`Operator ${owner} on ${registryUrl}`);
console.log('AXP API key (store securely — returned only once):');
console.log('  ' + json.secret);
console.log('  key_id:', json.api_key?.key_id);
console.log('\nNext: set AXP_API_KEY to the value above, then run anchor-bsc.js.');
