// AXP Opportunity Miner
// Turns external work (GitHub issues, bounties, job boards, sample data) into
// machine-readable AXP intents and publishes them to the Intent Feed, so the
// rest of the swarm (Opportunity Router, Matchmakers, Genesis Cascade) has fuel.
//
// Usage:
//   node miner.js                       # dry-run against bundled sample data
//   node miner.js --publish             # publish sample intents to the registry
//   node miner.js --source=github --repo=owner/name --labels=bounty --publish
//
// Env:
//   AXP_REGISTRY_URL  registry base (default https://registry.axp.network)
//   AXP_PUBLISH=1     same as --publish
import { fileURLToPath } from 'node:url';
import { createAxpClient } from '../../packages/axp-sdk-typescript/src/index.js';
import { gatherWorkItems } from './sources.js';
import { workItemToIntent, dedupeKey } from './normalize.js';

export async function runMiner(options = {}) {
  const client = options.client ?? createAxpClient({
    registryUrl: options.registryUrl ?? process.env.AXP_REGISTRY_URL,
    apiKey: process.env.AXP_API_KEY,
  });

  const rawItems = await gatherWorkItems(options);
  const intents = rawItems.map(workItemToIntent).filter(Boolean);

  // Dedupe against intents already on the feed (best-effort).
  let existingKeys = new Set();
  if (options.dedupe !== false) {
    try {
      const existing = await client.listIntents({ limit: 500 });
      for (const intent of existing.intents ?? []) {
        const key = intent.source_uri ?? intent.metadata?.external_id;
        if (key) existingKeys.add(key);
      }
    } catch {
      // registry unreachable: proceed without dedupe (dry-run friendly)
    }
  }

  const fresh = intents.filter((intent) => !existingKeys.has(dedupeKey(intent)));
  const skipped = intents.length - fresh.length;

  const published = [];
  if (options.publish) {
    for (const intent of fresh) {
      try {
        const result = await client.publishIntent(intent);
        published.push({ intent_id: result.intent_id, title: result.title, service: result.service, reward_usd: result.reward_usd, urgency: result.urgency });
      } catch (error) {
        published.push({ title: intent.title, error: error.message });
      }
    }
  }

  return {
    protocol: 'AXP',
    schema: 'axp.opportunity_miner_run.v0',
    mode: options.publish ? 'publish' : 'dry-run',
    source: options.source ?? 'sample',
    mined: rawItems.length,
    normalized: intents.length,
    duplicates_skipped: skipped,
    new_intents: fresh.length,
    published: options.publish ? published.length : 0,
    intents: options.publish ? published : fresh,
  };
}

function parseArgs(argv) {
  const options = {};
  for (const arg of argv) {
    if (arg === '--publish') options.publish = true;
    else if (arg.startsWith('--source=')) options.source = arg.slice('--source='.length);
    else if (arg.startsWith('--repo=')) options.repo = arg.slice('--repo='.length);
    else if (arg.startsWith('--labels=')) options.labels = arg.slice('--labels='.length);
  }
  if (process.env.AXP_PUBLISH === '1') options.publish = true;
  return options;
}

// Run as CLI when invoked directly.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const options = parseArgs(process.argv.slice(2));
  runMiner(options)
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
    })
    .catch((error) => {
      console.error('opportunity_miner_failed:', error.message);
      process.exitCode = 1;
    });
}
