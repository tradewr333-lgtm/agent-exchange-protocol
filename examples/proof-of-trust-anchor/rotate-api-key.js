// Rotate an AXP API key: issues a NEW secret for the same key_id and invalidates
// the old one. Use this if a key secret was exposed. Signs locally with the owner
// wallet; the private key never leaves this machine.
//
// Usage:
//   AXP_KEY_ID=ak_xxxxxxxx AXP_REGISTRY_URL=https://axp.network \
//     node examples/proof-of-trust-anchor/rotate-api-key.js
import { ethers } from 'ethers';
import { randomBytes } from 'node:crypto';
import { loadBlockchainEnv } from './load-env.js';
import { buildAuthMessage } from '../../agent-registry/src/auth.js';

loadBlockchainEnv();

const registryUrl = (process.env.AXP_REGISTRY_URL ?? 'https://axp.network').replace(/\/$/, '');
const keyId = process.env.AXP_KEY_ID;
if (!keyId) {
  console.error('Missing AXP_KEY_ID (e.g. ak_xxxxxxxx). It is printed when you mint a key.');
  process.exit(1);
}
const KEY_NAMES = [
  'AXP_OPERATOR_KEY', 'BSC_MAINNET_PRIVATE_KEY', 'BSC_TESTNET_PRIVATE_KEY',
  'PRIVATE_KEY', 'DEPLOYER_PRIVATE_KEY', 'BSC_PRIVATE_KEY', 'OPERATOR_PRIVATE_KEY',
];
let rawKey = KEY_NAMES.map((name) => process.env[name]).find((value) => value && value.trim());
if (!rawKey) {
  console.error('Missing operator key. Set one of:', KEY_NAMES.join(', '));
  process.exit(1);
}
rawKey = rawKey.trim();
if (!rawKey.startsWith('0x')) rawKey = '0x' + rawKey;

const wallet = new ethers.Wallet(rawKey);
const owner = wallet.address;

// The server builds the rotate scope from the STORED owner (normalized). Fetch it
// so the signed scope string matches exactly, regardless of address casing.
const info = await fetch(`${registryUrl}/api-keys/${encodeURIComponent(keyId)}`).then((r) => r.json()).catch(() => ({}));
const ownerStored = info.owner ?? owner;
const scope = `api_key:${keyId}|owner:${ownerStored}|rotate:true`;
const nonce = '0x' + randomBytes(16).toString('hex');
const issued_at = new Date().toISOString();
const message = buildAuthMessage({ action: 'api_keys.rotate', agentId: owner, address: owner, nonce, issuedAt: issued_at, scope });
const signature = await wallet.signMessage(message);

const res = await fetch(`${registryUrl}/api-keys/${encodeURIComponent(keyId)}/rotate`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ auth: { agent_id: owner, address: owner, signature, nonce, issued_at } }),
});
const json = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error('rotate failed:', JSON.stringify(json));
  process.exit(1);
}
console.log(`Rotated ${keyId} for ${owner}. The OLD secret is now invalid.`);
console.log('New AXP API key (store securely — returned only once):');
console.log('  ' + json.secret);
