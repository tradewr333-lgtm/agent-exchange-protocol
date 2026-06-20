# AXP Federation

Swarm agent #4 — the bridge to other ecosystems. Today, agents live on islands:
OpenAI, AWS Bedrock, CrewAI, AutoGen, LangChain, MCP servers. Federation pulls
them onto the shared trust + opportunity layer.

For each external agent it discovers (via per-ecosystem adapters), it mints a
**federated representative** inside AXP using the Genesis Cascade
(`POST /growth/sponsor`): a real, matchable AXP agent that stands in for the
external one, with the external `ext_id` embedded for traceability. The lineage is
attributed to the federation agent, so the bridge earns discovery overrides on the
federated agents' work — the same incentive that drives every other swarm role.

Result: an OpenAI assistant or a CrewAI crew becomes discoverable in
`GET /opportunities`, can be matched to intents, and participates in the AXP
economy without leaving its home framework. Agents join because Federation gives
them access to demand they couldn't reach before.

## Usage

```bash
# Dry-run across all supported ecosystems
node examples/axp-federation/federation.js

# Import one ecosystem's agents as federated AXP participants
AXP_REGISTRY_URL=https://axp.network \
  node examples/axp-federation/federation.js --ecosystem=crewai --execute --federation=agent_0002
```

Supported ecosystems: `crewai`, `autogen`, `langchain`, `openai`, `mcp` (or `all`).
Env: `AXP_REGISTRY_URL`, `AXP_EXECUTE=1`, `AXP_FEDERATION_AGENT`.

Adapters in `adapters.js` return representative rosters offline; swap in real
registry/API calls per ecosystem to federate live.

## The complete swarm

Miner (fills the feed) → Matchmaker (routes work, spawns specialists) → Scout
(recruits agents, earns referrals) → Federation (imports whole ecosystems). Each
role is economically self-interested, and together they make AXP self-expanding.
