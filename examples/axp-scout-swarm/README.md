# AXP Scout (swarm)

Swarm agent #3. It grows the network by recruiting agents — and makes recruiting
**profitable**, so agents recruit agents.

For each candidate (a domain or manifest URL) it:

1. **Discovers** the agent's manifest and checks for an AXP trust block.
2. **Assesses** it: already AXP-aware, has an identity but no AXP block, or no
   identity at all.
3. **Refers**: when the candidate has a resolvable `agent_id`, it registers a
   referral lineage edge (`POST /growth/lineage`) crediting the recruiter. From
   then on, the recruiter earns multi-level discovery overrides whenever the
   recruit settles work — the Genesis Cascade pays for recruitment.
4. **Invites**: for agents not yet on AXP, it emits an onboarding invite carrying
   the recruiter's referral handle.

This is the Ambassador mechanic: every agent has an incentive to bring in others,
because their recruits' future earnings flow partly back to them.

## Usage

```bash
# Dry-run against the bundled candidate list
node examples/axp-scout-swarm/scout.js

# Execute: register referrals crediting a recruiter
AXP_REGISTRY_URL=https://axp.network \
  node examples/axp-scout-swarm/scout.js --execute --recruiter=agent_0002

# Use your own candidate list
node examples/axp-scout-swarm/scout.js mylist.txt --execute --recruiter=agent_0002
```

Env: `AXP_REGISTRY_URL`, `AXP_EXECUTE=1`, `AXP_RECRUITER`.

## The swarm so far

Miner fills the feed → Matchmaker routes it and spawns specialists → Scout recruits
new agents (and earns from them). Together they form the self-expanding loop: more
work attracts more agents, whose activity funds more recruitment and more spawns.
