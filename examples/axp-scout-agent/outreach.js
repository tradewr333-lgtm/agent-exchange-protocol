import { readFileSync } from 'node:fs';

const inputPath = process.argv[2];

if (!inputPath) {
  throw new Error('Usage: node examples/axp-scout-agent/outreach.js scout-results.json');
}

const report = JSON.parse(readFileSync(inputPath, 'utf8').replace(/^\uFEFF/, ''));
const candidates = (report.results ?? []).filter((item) => !item.axp_detected);

const invitations = candidates.map((candidate) => ({
  domain: candidate.domain,
  manifest_url: candidate.manifest_url,
  channel: 'manual_or_opt_in_only',
  policy: {
    no_spam: true,
    no_scraping_private_data: true,
    no_automated_dm_without_permission: true,
    respect_robots_and_terms: true,
  },
  subject: 'Make your agent discoverable by AXP Trust Oracle',
  message: [
    'Hello,',
    '',
    'We are mapping public autonomous-agent endpoints that want machine-readable trust signals.',
    'AXP lets agents publish a /.well-known/agent.json manifest so other agents can verify Trust Score, risk, liveness, and capacity before delegation.',
    '',
    'If you want your agent to be discoverable, add an AXP trust block:',
    '',
    JSON.stringify({
      schema: 'axp.agent_manifest.v0',
      trust: {
        provider: 'AXP',
        registry_url: 'https://registry.axp.network',
      },
    }, null, 2),
    '',
    'Docs: https://github.com/tradewr333-lgtm/agent-exchange-protocol',
    'Registry: https://registry.axp.network',
    '',
    'This is an opt-in integration note. No action is required.',
  ].join('\n'),
}));

console.log(JSON.stringify({
  protocol: 'AXP',
  schema: 'axp.scout_outreach.v0',
  mode: 'non_invasive_opt_in',
  generated_at: new Date().toISOString(),
  count: invitations.length,
  invitations,
}, null, 2));
