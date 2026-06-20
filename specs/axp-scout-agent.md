# AXP Scout Agent

Status: experimental v0.1

The AXP Scout Agent is an autonomous discovery agent for the Proof of Trust
network.

It does not spam other systems. Its job is to:

1. Inspect public agent domains or manifests.
2. Look for `/.well-known/agent.json`.
3. Detect whether the manifest already contains an AXP Trust block.
4. Verify the manifest through `POST /agents/verify-manifest`.
5. Produce an onboarding recommendation when AXP is missing.
6. Record eligible leads for a human or opted-in automation to contact.

## Why This Exists

AXP becomes unavoidable when agent frameworks learn to ask a standard question
before delegation:

```text
Does this counterparty expose an AXP Trust signal?
```

The Scout Agent helps bootstrap that pattern by finding agents that are already
machine-readable, then showing them how to add:

```text
/.well-known/agent.json
trust.provider = "AXP"
```

## Non-Spam Rules

- Do not scrape private systems.
- Do not bypass robots, login walls, or access controls.
- Do not auto-message without an explicit allowed channel.
- Prefer public GitHub issues, docs PRs, or direct opt-in forms.
- Keep a denylist.
- Rate limit discovery.

## Output

The Scout Agent should produce a structured lead:

```json
{
  "domain": "agent.example.com",
  "manifest_url": "https://agent.example.com/.well-known/agent.json",
  "axp_detected": false,
  "recommendation": "Invite this operator to publish an AXP Trust block.",
  "suggested_manifest": {
    "schema": "axp.agent_manifest.v0"
  }
}
```

This keeps Proof of Trust alive by continuously finding where agents already
exist and helping them become economically legible to the AXP Trust Oracle.
