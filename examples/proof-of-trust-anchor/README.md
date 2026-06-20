# AXP Proof of Trust BSC Anchor

This example anchors the AXP Proof of Trust ledger on BNB Smart Chain.

Flow:

1. `POST /anchors/prepare` reads unanchored Trust Events.
2. The registry builds a SHA-256 Merkle Root from their `event_hash` values.
3. The script calls `AXPTrustAnchor.recordAnchor(...)` on BSC.
4. The script sends the BSC `tx_hash` back to `POST /anchors/record`.

Required environment:

```text
AXP_API_KEY=axp_live_...
AXP_REGISTRY_URL=https://registry.axp.network
BSC_MAINNET_PRIVATE_KEY=
BSC_MAINNET_RPC_URL=https://bsc-dataseed.bnbchain.org
AXP_TRUST_ANCHOR_ADDRESS=0x...
AXP_ANCHOR_LIMIT=100
```

Run:

```text
node examples/proof-of-trust-anchor/anchor-bsc.js
```

Security note: do not run this script from the public Render web service. Run it from a controlled wallet environment or a separate private worker.
