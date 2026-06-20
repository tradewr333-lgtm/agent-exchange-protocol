import { createAxpClient } from '../../packages/axp-sdk-typescript/src/index.js';

const axp = createAxpClient({
  apiKey: process.env.AXP_API_KEY,
});

const target = process.argv[2] ?? 'agent.example.com';
const manifestUrl = target.startsWith('https://')
  ? target
  : `https://${target}/.well-known/agent.json`;

console.log(`Discovering AXP agent manifest at ${manifestUrl}`);

const verification = await axp.verifyAgentManifest({
  manifest_url: manifestUrl,
});

console.log(JSON.stringify(verification, null, 2));
