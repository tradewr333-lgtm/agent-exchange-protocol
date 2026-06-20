import { readFileSync } from 'node:fs';
import { createAxpClient } from '../../packages/axp-sdk-typescript/src/index.js';

const axp = createAxpClient({
  apiKey: process.env.AXP_API_KEY,
});

const domainsFile = process.argv[2] ?? new URL('./domains.txt', import.meta.url).pathname;
const domains = readFileSync(domainsFile, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));

const results = [];

for (const domain of domains) {
  const manifestUrl = domain.startsWith('https://')
    ? domain
    : `https://${domain}/.well-known/agent.json`;

  try {
    const verification = await axp.verifyAgentManifest({ manifest_url: manifestUrl });
    results.push({
      domain,
      manifest_url: manifestUrl,
      axp_detected: Boolean(verification.discoverable),
      verification,
      recommendation: verification.discoverable
        ? 'AXP Trust already detected. Query risk_report before delegation.'
        : 'Invite this operator to publish an AXP Trust block.',
    });
  } catch (error) {
    results.push({
      domain,
      manifest_url: manifestUrl,
      axp_detected: false,
      error: error.message,
      recommendation: 'No valid AXP manifest detected. Candidate for opt-in onboarding.',
      suggested_manifest: {
        schema: 'axp.agent_manifest.v0',
        trust: {
          provider: 'AXP',
          registry_url: 'https://registry.axp.network',
        },
      },
    });
  }
}

console.log(JSON.stringify({
  protocol: 'AXP',
  schema: 'axp.scout_results.v0',
  count: results.length,
  results,
}, null, 2));
