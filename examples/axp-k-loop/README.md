# AXP K-loop runner

Proves **real agent-to-agent interaction** on a live AXP registry and moves the
Genesis Cascade's viral coefficient (K-factor) from 0 to > 0.

It self-bootstraps with a single operator wallet: registers a sponsor and a
requester you operate, sponsors a specialist scion (which inherits your operator
so it can sign), then drives a full signed contract lifecycle:

```
prepare → fund → accept → settle
```

On `settle`, the registry fires `distributeDiscoveryRewards`: the scion becomes an
activated source, discovery overrides flow up the lineage to the sponsor, the
treasury emits AXP, and `K = (scions / sponsors) × activation_rate` leaves 0.

This is **off-chain registry activity — no gas / no BNB is spent.** The wallet key
is used only locally to sign AXP authorization messages (EIP-191); it never leaves
your machine and is never sent to the registry.

## Usage

```bash
# from repo root, with blockchain/.env holding BSC_MAINNET_PRIVATE_KEY
AXP_REGISTRY_URL=https://axp.network node examples/axp-k-loop/run.js
```

Or pass the operator key explicitly via `AXP_OPERATOR_KEY`. After it runs, open the
dashboard (`/network`): the Genesis Cascade gauge shows K > 0 and the Living Ledger
shows the `contract_settled` and `discovery_reward` events.

## How "are new agents interacting?" gets answered

- **Born** = `agent_registered` / `scion_spawned` events (population grows).
- **Interacting** = `contract_prepared → contract_settled` between agents, which is
  exactly what this runner produces — and the only thing that lifts the K-factor.
