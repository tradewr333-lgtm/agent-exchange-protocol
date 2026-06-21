import { ethers } from 'ethers';
import { loadBlockchainEnv } from './load-env.js';
import { mintApiKey } from './api-key.js';

loadBlockchainEnv();

// AXP_ANCHOR_NETWORK = 'testnet' (BSC chainId 97) or 'mainnet' (chainId 56, default).
const isTestnet = (process.env.AXP_ANCHOR_NETWORK ?? 'mainnet').toLowerCase() === 'testnet';
const chainId = isTestnet ? 97 : 56;

const registryUrl = (process.env.AXP_REGISTRY_URL ?? 'https://axp.network').replace(/\/$/, '');
// Ignore any placeholder / non-real value so we auto-mint instead of 401-ing.
let apiKey = (process.env.AXP_API_KEY || '').startsWith('axp_live_') ? process.env.AXP_API_KEY : undefined;
const privateKey = isTestnet
  ? (process.env.BSC_TESTNET_PRIVATE_KEY || process.env.AXP_OPERATOR_KEY)
  : (process.env.BSC_MAINNET_PRIVATE_KEY || process.env.BSC_TESTNET_PRIVATE_KEY || process.env.AXP_OPERATOR_KEY);
const rpcUrl = isTestnet
  ? (process.env.BSC_TESTNET_RPC_URL ?? 'https://data-seed-prebsc-1-s1.bnbchain.org:8545')
  : (process.env.BSC_MAINNET_RPC_URL ?? 'https://bsc-dataseed.bnbchain.org');
const anchorAddress = process.env.AXP_TRUST_ANCHOR_ADDRESS;
const limit = Number(process.env.AXP_ANCHOR_LIMIT ?? 100);

if (!privateKey) {
  throw new Error(`Missing ${isTestnet ? 'BSC_TESTNET_PRIVATE_KEY' : 'BSC_MAINNET_PRIVATE_KEY'}`);
}
if (!/^0x[a-fA-F0-9]{40}$/.test(anchorAddress || '')) {
  throw new Error(`AXP_TRUST_ANCHOR_ADDRESS must be a real deployed 0x address (got: ${anchorAddress ?? 'unset'}). Deploy the contract first.`);
}
console.log(`Anchoring to BSC ${isTestnet ? 'testnet' : 'mainnet'} (chainId ${chainId}) via ${rpcUrl}`);

const anchorAbi = [
  'function recordAnchor(bytes32 merkleRoot,uint256 fromEventId,uint256 toEventId,uint256 eventCount,string registryUrl,string batchUri) external returns (uint256)',
];

const provider = new ethers.JsonRpcProvider(rpcUrl);
const signer = new ethers.Wallet(privateKey, provider);
const contract = new ethers.Contract(anchorAddress, anchorAbi, signer);

// No API key supplied? Mint one in-memory from the same wallet — never printed,
// never pasted. The /anchors/* endpoints need a key; this provisions it silently.
if (!apiKey) {
  apiKey = (await mintApiKey({ registryUrl, wallet: signer })).secret;
  console.log('Auto-minted a temporary AXP API key for this anchor (kept in memory, not printed).');
}

const prepared = await postJson('/anchors/prepare', {
  limit,
  chain_id: chainId,
  contract_address: anchorAddress,
  registry_url: registryUrl,
});

console.log(JSON.stringify({
  step: 'prepared_anchor_batch',
  batch_id: prepared.batch_id,
  merkle_root: prepared.merkle_root,
  from_event_id: prepared.from_event_id,
  to_event_id: prepared.to_event_id,
  event_count: prepared.event_count,
}, null, 2));

// Graceful no-op for scheduled/periodic runs: nothing new to anchor.
if (!prepared.event_count || !prepared.merkle_root) {
  console.log('No new trust events since the last anchor — nothing to record.');
  process.exit(0);
}

const tx = await contract.recordAnchor(
  prepared.merkle_root,
  prepared.from_event_id,
  prepared.to_event_id,
  prepared.event_count,
  prepared.registry_url,
  prepared.batch_uri,
);
console.log(`Submitted BSC trust anchor tx: ${tx.hash}`);

const receipt = await tx.wait();
console.log(`Confirmed BSC trust anchor in block ${receipt.blockNumber}`);

const recorded = await postJson('/anchors/record', {
  batch_id: prepared.batch_id,
  merkle_root: prepared.merkle_root,
  from_event_id: prepared.from_event_id,
  to_event_id: prepared.to_event_id,
  event_count: prepared.event_count,
  chain_id: chainId,
  contract_address: anchorAddress,
  tx_hash: tx.hash,
  block_number: receipt.blockNumber,
  registry_url: registryUrl,
  batch_uri: prepared.batch_uri,
});

console.log(JSON.stringify({
  step: 'recorded_anchor_receipt',
  anchor: recorded,
}, null, 2));

async function postJson(path, body) {
  const response = await fetch(`${registryUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-axp-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${path} failed: ${JSON.stringify(payload)}`);
  }
  return payload;
}
