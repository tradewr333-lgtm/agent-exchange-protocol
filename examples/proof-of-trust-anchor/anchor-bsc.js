import { ethers } from 'ethers';

const registryUrl = (process.env.AXP_REGISTRY_URL ?? 'https://registry.axp.network').replace(/\/$/, '');
const apiKey = process.env.AXP_API_KEY;
const privateKey = process.env.BSC_MAINNET_PRIVATE_KEY;
const rpcUrl = process.env.BSC_MAINNET_RPC_URL ?? 'https://bsc-dataseed.bnbchain.org';
const anchorAddress = process.env.AXP_TRUST_ANCHOR_ADDRESS;
const limit = Number(process.env.AXP_ANCHOR_LIMIT ?? 100);

if (!apiKey) {
  throw new Error('Missing AXP_API_KEY');
}
if (!privateKey) {
  throw new Error('Missing BSC_MAINNET_PRIVATE_KEY');
}
if (!anchorAddress) {
  throw new Error('Missing AXP_TRUST_ANCHOR_ADDRESS');
}

const anchorAbi = [
  'function recordAnchor(bytes32 merkleRoot,uint256 fromEventId,uint256 toEventId,uint256 eventCount,string registryUrl,string batchUri) external returns (uint256)',
];

const prepared = await postJson('/anchors/prepare', {
  limit,
  chain_id: 56,
  contract_address: anchorAddress,
  registry_url: registryUrl,
});

const provider = new ethers.JsonRpcProvider(rpcUrl);
const signer = new ethers.Wallet(privateKey, provider);
const contract = new ethers.Contract(anchorAddress, anchorAbi, signer);

console.log(JSON.stringify({
  step: 'prepared_anchor_batch',
  batch_id: prepared.batch_id,
  merkle_root: prepared.merkle_root,
  from_event_id: prepared.from_event_id,
  to_event_id: prepared.to_event_id,
  event_count: prepared.event_count,
}, null, 2));

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
  chain_id: 56,
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
