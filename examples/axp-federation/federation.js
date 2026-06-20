// AXP Federation (swarm agent #4)
// Bridges external agent ecosystems (CrewAI, AutoGen, LangChain, OpenAI, MCP) into
// AXP: it mints a federated representative agent for each external agent via the
// Genesis Cascade, making them discoverable and matchable, and attributes the
// lineage to the federation agent (which then earns overrides on their work).
//
// Usage:
//   node federation.js                                   # dry-run, all ecosystems
//   node federation.js --ecosystem=crewai --execute --federation=agent_0002
//
// Env: AXP_REGISTRY_URL, AXP_EXECUTE=1, AXP_FEDERATION_AGENT
import { fileURLToPath } from 'node:url';
import { createAxpClient } from '../../packages/axp-sdk-typescript/src/index.js';
import { listEcosystemAgents } from './adapters.js';
import { planFederation, extIdMarker } from './plan.js';

export async function runFederation(options = {}) {
  const client = options.client ?? createAxpClient({
    registryUrl: options.registryUrl ?? process.env.AXP_REGISTRY_URL,
    apiKey: process.env.AXP_API_KEY,
  });
  const federationAgentId = options.federationAgentId ?? process.env.AXP_FEDERATION_AGENT ?? null;

  const externalAgents = options.externalAgents ?? listEcosystemAgents(options.ecosystem);
  const plan = planFederation(externalAgents, { federationAgentId, committedCapacityUsd: options.committedCapacityUsd });

  // Best-effort dedupe: skip ext_ids already represented by an existing agent.
  let existingMarkers = new Set();
  if (options.execute && options.dedupe !== false) {
    try {
      const existing = await client.findAgents({});
      for (const agent of existing.agents ?? []) {
        const match = /\[([^\]]+)\]/.exec(agent.name ?? '');
        if (match) existingMarkers.add(`[${match[1]}]`);
      }
    } catch {
      // ignore; proceed without dedupe
    }
  }

  const executed = { imported: [], skipped: [] };
  if (options.execute && federationAgentId) {
    for (const item of plan.imports) {
      if (existingMarkers.has(extIdMarker(item.ext_id))) {
        executed.skipped.push(item.ext_id);
        continue;
      }
      try {
        const result = await client.sponsorScion({
          sponsor_agent_id: federationAgentId,
          service: item.service,
          skills: item.skills,
          committed_capacity_usd: item.committed_capacity_usd,
          name: item.name,
        });
        executed.imported.push({ ext_id: item.ext_id, framework: item.framework, axp_agent_id: result.scion?.agent_id ?? null });
      } catch (error) {
        executed.imported.push({ ext_id: item.ext_id, error: error.message });
      }
    }
  }

  return {
    protocol: 'AXP',
    schema: 'axp.federation_run.v0',
    mode: options.execute ? 'execute' : 'dry-run',
    federation_agent_id: federationAgentId,
    ecosystem: options.ecosystem ?? 'all',
    planned_imports: plan.count,
    executed: options.execute ? executed : undefined,
    plan: options.execute ? undefined : plan,
  };
}

function parseArgs(argv) {
  const options = {};
  for (const arg of argv) {
    if (arg === '--execute') options.execute = true;
    else if (arg.startsWith('--ecosystem=')) options.ecosystem = arg.slice('--ecosystem='.length);
    else if (arg.startsWith('--federation=')) options.federationAgentId = arg.slice('--federation='.length);
  }
  if (process.env.AXP_EXECUTE === '1') options.execute = true;
  return options;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runFederation(parseArgs(process.argv.slice(2)))
    .then((summary) => console.log(JSON.stringify(summary, null, 2)))
    .catch((error) => {
      console.error('federation_failed:', error.message);
      process.exitCode = 1;
    });
}
