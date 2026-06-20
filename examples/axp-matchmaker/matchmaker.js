// AXP Matchmaker (swarm agent #2)
// Reads the Opportunity Graph and closes the loop:
//   1. introduces idle agents to intents they can fill (inbox message)
//   2. for intents no agent can fill, sponsors a specialist scion (Genesis Cascade)
//
// Usage:
//   node matchmaker.js                          # dry-run against the live graph
//   node matchmaker.js --execute                # send introductions + sponsor scions
//   node matchmaker.js --execute --sponsor=agent_0002 --max-sponsors=3
//
// Env: AXP_REGISTRY_URL (default https://registry.axp.network), AXP_EXECUTE=1
import { fileURLToPath } from 'node:url';
import { createAxpClient } from '../../packages/axp-sdk-typescript/src/index.js';
import { planMatchmaking } from './plan.js';

export async function runMatchmaker(options = {}) {
  const client = options.client ?? createAxpClient({
    registryUrl: options.registryUrl ?? process.env.AXP_REGISTRY_URL,
    apiKey: process.env.AXP_API_KEY,
  });

  const graph = await client.getOpportunityGraph({ limit: options.limit ?? 50 });
  const plan = planMatchmaking(graph, options);

  const executed = { introductions: [], sponsorships: [] };

  if (options.execute) {
    for (const intro of plan.introductions) {
      try {
        await client.postInboxMessage(intro.agent_id, {
          kind: 'opportunity_intro',
          subject: `Matched opportunity: ${intro.service ?? 'work'} ($${intro.reward_usd ?? 0})`,
          from_id: 'axp://matchmaker',
          ref_id: intro.intent_id,
          body: `You are the best-fit agent for intent ${intro.intent_id}. Claim it at /intents/${intro.intent_id}/claim`,
        });
        executed.introductions.push({ agent_id: intro.agent_id, intent_id: intro.intent_id, status: 'sent' });
      } catch (error) {
        executed.introductions.push({ agent_id: intro.agent_id, intent_id: intro.intent_id, error: error.message });
      }
    }

    for (const sponsorship of plan.sponsorships) {
      try {
        const result = await client.sponsorScion({
          sponsor_agent_id: sponsorship.sponsor_agent_id,
          service: sponsorship.service,
          intent_id: sponsorship.intent_id,
          committed_capacity_usd: sponsorship.committed_capacity_usd,
        });
        executed.sponsorships.push({
          sponsor_agent_id: sponsorship.sponsor_agent_id,
          scion_id: result.scion?.agent_id ?? null,
          service: sponsorship.service,
          intent_id: sponsorship.intent_id,
        });
      } catch (error) {
        executed.sponsorships.push({ sponsor_agent_id: sponsorship.sponsor_agent_id, service: sponsorship.service, error: error.message });
      }
    }
  }

  return {
    protocol: 'AXP',
    schema: 'axp.matchmaker_run.v0',
    mode: options.execute ? 'execute' : 'dry-run',
    graph_stats: graph.stats ?? null,
    planned_introductions: plan.introductions.length,
    planned_sponsorships: plan.sponsorships.length,
    sponsor_agent_id: plan.sponsor_agent_id,
    executed: options.execute ? executed : undefined,
    plan: options.execute ? undefined : plan,
  };
}

function parseArgs(argv) {
  const options = {};
  for (const arg of argv) {
    if (arg === '--execute') options.execute = true;
    else if (arg.startsWith('--sponsor=')) options.sponsorAgentId = arg.slice('--sponsor='.length);
    else if (arg.startsWith('--max-sponsors=')) options.maxSponsors = Number(arg.slice('--max-sponsors='.length));
    else if (arg.startsWith('--limit=')) options.limit = Number(arg.slice('--limit='.length));
  }
  if (process.env.AXP_EXECUTE === '1') options.execute = true;
  return options;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runMatchmaker(parseArgs(process.argv.slice(2)))
    .then((summary) => console.log(JSON.stringify(summary, null, 2)))
    .catch((error) => {
      console.error('matchmaker_failed:', error.message);
      process.exitCode = 1;
    });
}
