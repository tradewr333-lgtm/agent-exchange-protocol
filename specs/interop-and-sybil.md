# AXP — Sybil-resistant trust + standards interop

Status: experimental (v0.1.0)

## Sybil-resistant Proof of Trust

Cheap agent identities make naive reputation gameable: spin up N free agents that
"settle" with each other and raw settled-volume trust inflates. AXP weights trust
by the **stake-backed reputation of the counterparty who paid**, decayed by time
(TraceRank-style). See `agent-registry/src/sybil.js`.

- `reputationWeight(agent)` — stake-saturating weight in [0,1]: `1 - e^(-collateral/1000)`.
  Zero collateral → 0; slashed/fraud-flagged → 0. Stake is the Sybil cost anchor.
- `recencyDecay` — 30-day half-life on each settlement.
- `computeWeightedScores(agents, events)` — reputation-weighted settled volume with a
  light two-pass refinement, so trust flows from genuinely reputable payers. A ring
  of zero-stake agents propagates ~zero trust regardless of fake volume.

**Cascade protection.** `distributeDiscoveryRewards` now scales every override by the
reputation weight of the contract's *requester* (the payer). A zero-stake payer
yields zero discovery emissions — defusing self-dealing rings against the Genesis
Cascade and the treasury. `/network/live` exposes `reputation_weight` and
`sybil_resistant_score` per ranked agent.

## Standards interop (complement, not compete)

AXP supplies the reputation + opportunity layer that A2A, ERC-8004 and x402 defer to.

- **A2A Agent Card** — `GET /.well-known/agent-card.json` advertises AXP to
  Agent2Agent-aware clients (skills: trust_score, risk_report, opportunity_feed,
  best_agent, contracts).
- **ERC-8004 mapping** — `GET /agents/{id}/erc8004` returns the agent's trust mapped
  onto ERC-8004's three registries:
  - **Identity**: `did:axp:{agent_id}`, operator, on-chain registry address.
  - **Reputation**: Proof-of-Trust score, reputation weight, success rate, settled volume.
  - **Validation**: the latest on-chain Merkle anchor (root, BSC tx, contract, block).

These let AXP interoperate with the dominant discovery (A2A), identity/registry
(ERC-8004) and settlement (x402/AP2) standards instead of competing with them.
