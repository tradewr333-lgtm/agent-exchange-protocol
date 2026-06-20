// AXP Scout (swarm agent #3)
// Discovers candidate agents, assesses whether they are AXP-aware, registers
// referral attribution (recruiter -> recruit) so recruiting earns Genesis Cascade
// overrides, and emits onboarding invites for agents not yet on AXP.
//
// Usage:
//   node scout.js                                  # dry-run against candidates.txt
//   node scout.js --execute --recruiter=agent_0002 # register referrals
//   node scout.js mylist.txt --execute --recruiter=agent_0002
//
// Env: AXP_REGISTRY_URL, AXP_EXECUTE=1, AXP_RECRUITER
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createAxpClient } from '../../packages/axp-sdk-typescript/src/index.js';
import { planRecruitment, buildInvite } from './assess.js';

export async function runScout(options = {}) {
  const client = options.client ?? createAxpClient({
    registryUrl: options.registryUrl ?? process.env.AXP_REGISTRY_URL,
    apiKey: process.env.AXP_API_KEY,
  });
  const recruiterAgentId = options.recruiterAgentId ?? process.env.AXP_RECRUITER ?? null;

  const targets = options.candidates ?? loadCandidatesFile(options.path);
  const discover = options.discover ?? ((target) => discoverViaClient(client, target));

  const candidates = [];
  for (const target of targets) {
    try {
      candidates.push(await discover(target));
    } catch (error) {
      candidates.push({ domain: target, agent_id: null, on_axp: false, services: [], error: error.message });
    }
  }

  const plan = planRecruitment(candidates, { recruiterAgentId });
  const recruiterHandle = recruiterAgentId ? `axp://${recruiterAgentId}` : null;
  const invites = plan.assessments
    .filter((a) => a.action === 'invite' || a.action === 'invite_and_refer')
    .map((a) => buildInvite(a, { recruiterHandle }));

  const executed = { referrals: [] };
  if (options.execute && recruiterAgentId) {
    for (const referral of plan.referrals) {
      try {
        const result = await client.registerLineage(referral);
        executed.referrals.push({ agent_id: referral.agent_id, sponsor_agent_id: referral.sponsor_agent_id, depth: result.depth });
      } catch (error) {
        executed.referrals.push({ agent_id: referral.agent_id, error: error.message });
      }
    }
  }

  return {
    protocol: 'AXP',
    schema: 'axp.scout_run.v0',
    mode: options.execute ? 'execute' : 'dry-run',
    recruiter_agent_id: recruiterAgentId,
    assessed: plan.assessed,
    planned_referrals: plan.referrals.length,
    invites,
    executed: options.execute ? executed : undefined,
    assessments: options.execute ? undefined : plan.assessments,
  };
}

async function discoverViaClient(client, target) {
  const discovery = await client.discoverAgentManifest(target);
  return {
    domain: typeof target === 'string' ? target : (target.domain ?? target.manifest_url ?? null),
    manifest_url: discovery.manifest_url ?? null,
    agent_id: discovery.agent_id ?? null,
    on_axp: Boolean(discovery.axp_trust),
    services: discovery.manifest?.services ?? [],
  };
}

function loadCandidatesFile(path) {
  const file = path ?? fileURLToPath(new URL('./candidates.txt', import.meta.url));
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function parseArgs(argv) {
  const options = {};
  const positional = [];
  for (const arg of argv) {
    if (arg === '--execute') options.execute = true;
    else if (arg.startsWith('--recruiter=')) options.recruiterAgentId = arg.slice('--recruiter='.length);
    else positional.push(arg);
  }
  if (positional[0]) options.path = positional[0];
  if (process.env.AXP_EXECUTE === '1') options.execute = true;
  return options;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runScout(parseArgs(process.argv.slice(2)))
    .then((summary) => console.log(JSON.stringify(summary, null, 2)))
    .catch((error) => {
      console.error('scout_failed:', error.message);
      process.exitCode = 1;
    });
}
