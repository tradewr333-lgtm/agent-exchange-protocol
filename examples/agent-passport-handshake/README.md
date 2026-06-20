# AXP Agent Passport + Handshake

This example shows the AXP trust flow before an autonomous agent prepares a contract:

1. Load the counterparty Agent Passport.
2. Apply an AXP trust firewall policy.
3. Accept or reject the counterparty before any economic obligation is created.

```powershell
$env:AXP_API_KEY="axp_live_..."
node examples/agent-passport-handshake/run.js agent_demo_provider_mqme81sh
```

Optional policy variables:

```powershell
$env:AXP_MINIMUM_SCORE="100"
$env:AXP_MINIMUM_STAKE_USD="1000"
$env:AXP_MINIMUM_CAPACITY_USD="500"
$env:AXP_ALLOWED_RISK="LOW,MEDIUM"
$env:AXP_REQUIRE_ONLINE="true"
```

The intended default behavior is simple:

- Agent has AXP Passport and passes policy: continue to contract preparation.
- Agent has no AXP Passport: treat as `TRUST_UNKNOWN`.
- Agent fails policy: reject before contract creation.
