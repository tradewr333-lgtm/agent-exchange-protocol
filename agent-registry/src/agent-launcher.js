// Agent Launcher — "Launch an AI agent in 60 seconds".
//
// When a buyer pays the one-time Launch fee and clicks Launch, the AXP:
//   - generates a dedicated agent wallet / ID (deterministically from a server seed,
//     so the host can sign on the agent's behalf without persisting raw private keys),
//   - registers the agent in the AXP registry (joins the live graph + Opportunity Router),
//   - records lineage (origin: launch),
//   - mints an API key signed by the agent's own wallet,
//   - publishes the agent's public page,
//   - sets the first heartbeat (active).
//
// Hosting (a Stripe subscription) is what then keeps it alive and earning; see billing.js
// and the swarm scheduler's hosted-agent worker.

import { randomUUID } from 'node:crypto';
import { buildAuthMessage } from './auth.js';
import { loadAgentsRegistry, saveAgentsRegistry, saveLineageNode } from './store.js';
import { registerApiKey, buildApiKeyScope } from './api-keys.js';
import { templateById } from './agent-templates.js';

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

// Deterministic per-agent wallet so the host can re-derive the signer on demand
// (no raw private keys at rest). Falls back to a random wallet if no seed is set.
export async function deriveAgentWallet(agentId) {
  const { Wallet, id } = await import('ethers');
  const seed = process.env.AXP_AGENT_WALLET_SEED;
  if (seed) return new Wallet(id(`${seed}:${agentId}`));
  return Wallet.createRandom();
}

export function buildLaunchedAgent({ agentId, displayName, template, operator, ownerAddress, now, payment }) {
  return {
    agent_id: agentId,
    name: displayName,
    role: 'provider',
    status: 'active',
    services: [template.service],
    skills: template.skills,
    reputation: 1,
    stake_axp: 0,
    collateral: { accounting_unit: 'USD', status: 'hosted', assets: [], total_usd: template.capacity_usd },
    available_capacity: template.capacity_usd,
    completed_contracts: 0,
    failed_contracts: 0,
    failure_rate: 0,
    trust_metrics: {
      settled_volume_usd: 0, success_rate: 0, counterparty_diversity: 0, time_weight: 1,
      failed_volume_usd: 0, disputes_lost: 0, late_delivery_penalties: 0, slashing_events: 0, fraud_flags: 0,
    },
    heartbeat: {
      status: 'active', available: true, current_load: 0, available_capacity: template.capacity_usd,
      endpoint: null, version: '0.1.0', last_seen_at: now, expires_at: '2099-01-01T00:00:00.000Z', scope: 'hosted_agent',
    },
    owner: ownerAddress,
    origin: 'launch',
    template: template.id,
    hosting: { status: 'inactive', plan: null, active: false, subscription_id: null },
    launch_payment: payment ? { tx_hash: payment.tx_hash ?? null, asset: payment.asset ?? null, verified: Boolean(payment.verified) } : null,
    manifest: {
      protocol: 'AXP', version: '0.1.0', identity: `axp:agent:${agentId}`, origin: 'agent_launch',
      onchain: { network: 'BNB Smart Chain', chain_id: 56, operator },
    },
    created_at: now,
  };
}

export async function launchAgent({ template_id, owner_address, name, payment } = {}) {
  const template = templateById(template_id);
  if (!template) return { ok: false, status: 400, error: 'unknown_template', template_id };
  if (!owner_address || !ADDRESS_RE.test(owner_address)) {
    return { ok: false, status: 400, error: 'owner_address_invalid' };
  }

  const agentId = `agent_${template.id}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const wallet = await deriveAgentWallet(agentId);
  const operator = wallet.address;
  const displayName = (typeof name === 'string' && name.trim()) ? name.trim().slice(0, 60) : template.name;
  const now = new Date().toISOString();

  const registry = await loadAgentsRegistry();
  if (registry.agents.some((a) => a.agent_id === agentId)) {
    return { ok: false, status: 409, error: 'agent_exists' };
  }
  const agent = buildLaunchedAgent({ agentId, displayName, template, operator, ownerAddress: owner_address, now, payment });
  await saveAgentsRegistry({ ...registry, agents: [...registry.agents, agent] });

  try {
    await saveLineageNode({
      agent_id: agentId, handle: displayName, sponsor_agent_id: null, depth: 0,
      origin: 'launch', spawned_for_intent: null, owner: owner_address, created_at: now,
    });
  } catch (err) {
    console.error('launch_lineage_failed', err?.message || err);
  }

  // Mint an API key, signed by the agent's OWN wallet (so owner === signer).
  let apiKeySecret = null;
  let apiKeyId = null;
  try {
    const keyName = `${displayName} key`;
    const scope = buildApiKeyScope({ name: keyName, owner: operator, agent_id: agentId, framework: 'axp-hosted' });
    const nonce = `0x${randomUUID().replace(/-/g, '')}`;
    const issuedAt = now;
    const message = buildAuthMessage({ action: 'api_keys.register', agentId, address: operator, nonce, issuedAt, scope });
    const signature = await wallet.signMessage(message);
    const res = await registerApiKey({
      name: keyName, owner: operator, agent_id: agentId, framework: 'axp-hosted', tier: 'agent',
      auth: { agent_id: agentId, address: operator, signature, nonce, issued_at: issuedAt },
    });
    if (res.ok) {
      apiKeySecret = res.secret;
      apiKeyId = res.api_key?.key_id ?? null;
    }
  } catch (err) {
    console.error('launch_api_key_failed', err?.message || err);
  }

  return {
    ok: true,
    status: 201,
    agent: {
      agent_id: agentId, name: displayName, owner: owner_address, operator,
      template: template.id, services: agent.services, status: 'active', hosting: agent.hosting,
    },
    api_key: apiKeySecret,
    api_key_id: apiKeyId,
    public_page: `/agent/${agentId}`,
    note: 'Agent is live and in the graph. Subscribe to Hosting to keep it earning. Store the API key now — it is shown only once.',
  };
}
