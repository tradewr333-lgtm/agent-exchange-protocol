#!/usr/bin/env node
// AXP x402 test buyer — proves the autonomous single-call payment end to end.
//
// It calls a hosted agent's x402 endpoint. The official x402 client handles the whole
// flow automatically: receives the 402 quote, signs an EIP-3009 USDC authorization with
// your wallet, retries with the PAYMENT-SIGNATURE header, and the AXP server verifies +
// settles via the facilitator. You pay USDC; the agent runs the task and returns it.
//
// SETUP (one time):
//   1) Create a throwaway wallet; put its key in EVM_PRIVATE_KEY (0x...).
//   2) Fund it with TEST USDC on Base Sepolia (free): https://faucet.circle.com
//      (the buyer pays gas-free — the facilitator submits the tx — so no test ETH needed)
//   3) On the AXP server (Render), set:
//        AXP_X402_NETWORK=base-sepolia
//        AXP_X402_FACILITATOR_URL=https://x402.org/facilitator
//   4) npm install   (in this folder)
//
// RUN:
//   EVM_PRIVATE_KEY=0xYOURKEY \
//   AXP_AGENT_URL=https://axp.network/x402/agents/<AGENT_ID>/call \
//   AXP_TASK="Review: function add(a,b){return a-b}" \
//   node buy.mjs

import { wrapFetchWithPayment, x402HTTPClient } from '@x402/fetch';
import { x402Client } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';

const KEY = process.env.EVM_PRIVATE_KEY;
const URL = process.env.AXP_AGENT_URL;
const TASK = process.env.AXP_TASK || 'Review this function for bugs: function add(a,b){ return a - b; }';

if (!KEY || !URL) {
  console.error('Missing env. Required: EVM_PRIVATE_KEY (0x...), AXP_AGENT_URL (the /x402/agents/<id>/call URL).');
  process.exit(1);
}

const signer = privateKeyToAccount(KEY);
const client = new x402Client();
client.register('eip155:*', new ExactEvmScheme(signer)); // EVM "exact" scheme (USDC/EIP-3009)

const fetchWithPayment = wrapFetchWithPayment(fetch, client);
const httpClient = new x402HTTPClient(client);

console.log(`Buyer wallet: ${signer.address}`);
console.log(`Calling: ${URL}`);
console.log(`Task: ${TASK}\n`);

try {
  const response = await fetchWithPayment(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ task: TASK }),
  });
  const result = await httpClient.processResponse(response);
  console.log('--- AGENT RESULT ---');
  console.log(typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2));
  console.log('\n--- PAYMENT ---');
  console.log('status:', result.paymentStatus);
  if (result.header) console.log('settlement:', JSON.stringify(result.header));
} catch (err) {
  console.error('x402 buy failed:', err?.message || err);
  process.exit(1);
}
