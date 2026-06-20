// Pure planning core for the Federation bridge. Maps external-ecosystem agents to
// AXP import actions. Side-effect free for deterministic testing.

const DEFAULT_CAPACITY = 1000;

export function planFederation(externalAgents, options = {}) {
  const federationAgentId = options.federationAgentId ?? null;
  const committed = Number(options.committedCapacityUsd) > 0 ? Number(options.committedCapacityUsd) : DEFAULT_CAPACITY;

  const imports = (Array.isArray(externalAgents) ? externalAgents : [])
    .filter((agent) => agent && agent.ext_id)
    .map((agent) => {
      const services = Array.isArray(agent.services) ? agent.services : [];
      const [primary, ...rest] = services;
      return {
        ext_id: agent.ext_id,
        framework: agent.framework ?? 'unknown',
        name: `Federated ${agent.framework ?? 'agent'}: ${agent.name ?? agent.ext_id} [${agent.ext_id}]`,
        service: primary ?? 'general',
        skills: rest,
        committed_capacity_usd: committed,
      };
    });

  return {
    protocol: 'AXP',
    schema: 'axp.federation_plan.v0',
    federation_agent_id: federationAgentId,
    count: imports.length,
    imports,
  };
}

// Stable marker embedded in a federated agent's name so re-runs can dedupe.
export function extIdMarker(extId) {
  return `[${extId}]`;
}
