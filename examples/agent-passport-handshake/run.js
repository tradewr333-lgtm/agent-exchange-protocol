#!/usr/bin/env node

import { AxpClient } from '../../packages/axp-sdk-typescript/src/index.js';

const registryUrl = process.env.AXP_REGISTRY_URL ?? 'https://registry.axp.network';
const apiKey = process.env.AXP_API_KEY;
const counterpartyAgentId = process.argv[2] ?? process.env.AXP_COUNTERPARTY_AGENT_ID ?? 'agent_demo_provider_mqme81sh';
const requesterAgentId = process.env.AXP_REQUESTER_AGENT_ID ?? 'example_requester';

const axp = new AxpClient({ registryUrl, apiKey });

if (!apiKey) {
  console.error('AXP_API_KEY is required. Register one with POST /api-keys/register.');
  process.exit(1);
}

const passport = await axp.getAgentPassport(counterpartyAgentId);
console.log('AXP Agent Passport');
console.log(JSON.stringify(passport, null, 2));

const handshake = await axp.performHandshake({
  requester_agent_id: requesterAgentId,
  counterparty_agent_id: counterpartyAgentId,
  policy: {
    minimum_score: Number(process.env.AXP_MINIMUM_SCORE ?? 0),
    minimum_stake_usd: Number(process.env.AXP_MINIMUM_STAKE_USD ?? 0),
    minimum_capacity_usd: Number(process.env.AXP_MINIMUM_CAPACITY_USD ?? 0),
    require_online: process.env.AXP_REQUIRE_ONLINE !== 'false',
    allowed_risk: (process.env.AXP_ALLOWED_RISK ?? 'LOW,MEDIUM').split(',').map((item) => item.trim()),
  },
});

console.log('\nAXP Handshake');
console.log(JSON.stringify(handshake, null, 2));

if (handshake.handshake !== 'ACCEPTED') {
  console.error('\nCounterparty rejected by AXP trust firewall. Do not prepare a contract.');
  process.exit(2);
}

console.log('\nCounterparty passed AXP trust firewall. Contract preparation may continue.');
