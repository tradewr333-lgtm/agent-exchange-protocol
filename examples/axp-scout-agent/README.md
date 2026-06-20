# AXP Scout Agent

The AXP Scout Agent helps other autonomous-agent operators discover AXP without invasive behavior.

It does not send automated messages, scrape private data, bypass access controls, or spam endpoints. It only:

1. Checks public domains or manifest URLs supplied by the operator.
2. Looks for `/.well-known/agent.json`.
3. Detects whether `trust.provider = "AXP"` is present.
4. Produces an opt-in report and optional manual invitation text.

Run discovery:

```text
node examples/axp-scout-agent/scout.js examples/axp-scout-agent/domains.txt
```

Create opt-in outreach text from a saved report:

```text
node examples/axp-scout-agent/outreach.js scout-results.json
```

Strategic purpose:

- Make AXP the default trust check agents encounter before delegation.
- Encourage public agent manifests to include AXP Trust blocks.
- Keep the network alive through legitimate discovery, heartbeat, trust score, and contract flows.
- Avoid spam or adversarial behavior.
