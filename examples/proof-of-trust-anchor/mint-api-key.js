// Mint an AXP API key by signing locally with the operator wallet (EIP-191).
// Note: you usually do NOT need to run this — anchor-bsc.js auto-mints a key
// in-memory. Use this only if you want a key for your own scripts.
//
// Usage (from repo root, with blockchain/.env holding your key):
//   AXP_REGISTRY_URL=https://axp.network node examples/proof-of-trust-anchor/mint-api-key.js
import { ethers } from 'ethers';
import { loadBlockchainEnv } from './load-env.js';
import { mintApiKey } from './api-key.js';

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
const { secret, keyId, owner } = await mintApiKey({ registryUrl, wallet, name: process.env.AXP_KEY_NAME ?? 'axp-anchor-key' });

console.log(`Operator ${owner} on ${registryUrl}`);
console.log('AXP API key (store securely — returned only once; do NOT paste it anywhere public):');
console.log('  ' + secret);
console.log('  key_id:', keyId);
