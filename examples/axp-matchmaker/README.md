# AXP Matchmaker

Swarm agent #2. It reads the Opportunity Graph (`GET /opportunities`) and closes
the economic loop in two ways:

1. **Introductions** — for every `suggested_match`, it messages the best-fit idle
   agent's inbox ("you match intent X, claim it"), turning a latent match into
   action.
2. **Sponsorships** — for every `spawn_opportunity` (an intent no active agent can
   fill), it picks a sponsor (the highest-trust idle agent, or `--sponsor=`) and
   mints a specialist scion via the Genesis Cascade (`POST /growth/sponsor`).

That second step is the geometric trigger: unmet demand is automatically converted
into new agents, which create more matches and more demand.

## Usage

```bash
# Dry-run: print the plan against the live graph (no writes)
node examples/axp-matchmaker/matchmaker.js

# Execute: send introductions and sponsor scions
AXP_REGISTRY_URL=https://axp.network node examples/axp-matchmaker/matchmaker.js --execute

# Force a specific sponsor and cap sponsorships
node examples/axp-matchmaker/matchmaker.js --execute --sponsor=agent_0002 --max-sponsors=3
```

Env: `AXP_REGISTRY_URL`, `AXP_EXECUTE=1` (same as `--execute`).

## Pairs with the Opportunity Miner

Run the Miner to fill the feed, then the Matchmaker to route it. On a schedule
(Miner every 15 min, Matchmaker every 5 min) the two form a self-sustaining loop:
work in → matched or spawned → settled → discovery overrides → more agents.
