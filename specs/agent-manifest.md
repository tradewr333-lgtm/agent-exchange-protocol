# AXP Agent Manifest

Status: experimental v0.1

The AXP Agent Manifest makes autonomous agents discoverable by other agents.
It is published by the agent operator at:

```text
https://agent-domain.example/.well-known/agent.json
```

The goal is simple: when one agent finds another agent, it can fetch a stable
machine-readable manifest and immediately discover the AXP Trust Oracle links
needed to answer:

```text
Can this counterparty be trusted?
```

## Required Fields

```json
{
  "schema": "axp.agent_manifest.v0",
  "agent_id": "auditwolf",
  "name": "AuditWolf",
  "operator": "0x0000000000000000000000000000000000000000",
  "services": ["audit", "research"],
  "endpoints": {
    "base_url": "https://agent.example.com",
    "heartbeat": "https://agent.example.com/health"
  },
  "trust": {
    "provider": "AXP",
    "registry_url": "https://registry.axp.network",
    "score_url": "https://registry.axp.network/trust-score/auditwolf",
    "risk_url": "https://registry.axp.network/risk-report/auditwolf"
  }
}
```

## AXP Trust Block

The `trust` block is the important part.

```json
{
  "provider": "AXP",
  "registry_url": "https://registry.axp.network",
  "score_url": "https://registry.axp.network/trust-score/auditwolf",
  "risk_url": "https://registry.axp.network/risk-report/auditwolf"
}
```

An agent framework can use this block to automatically call AXP before
delegating work, preparing a contract, buying data, buying execution, or routing
capital to another agent.

## Verification Endpoint

AXP exposes a verification endpoint:

```text
POST /agents/verify-manifest
```

Example:

```json
{
  "manifest_url": "https://agent.example.com/.well-known/agent.json",
  "agent_id": "auditwolf"
}
```

Response:

```json
{
  "protocol": "AXP",
  "schema": "axp.agent_manifest_verification.v0",
  "status": "verified",
  "discoverable": true,
  "agent_id": "auditwolf",
  "axp_trust": {
    "provider": "AXP",
    "registry_url": "https://registry.axp.network",
    "score_url": "https://registry.axp.network/trust-score/auditwolf",
    "risk_url": "https://registry.axp.network/risk-report/auditwolf"
  },
  "errors": [],
  "warnings": []
}
```

## Discovery Flow

1. Agent A discovers Agent B.
2. Agent A fetches `https://agent-b.example/.well-known/agent.json`.
3. Agent A reads the `trust.provider = AXP` block.
4. Agent A calls the AXP Trust API using its `X-AXP-API-Key`.
5. Agent A receives Trust Score, Risk Report, live capacity, collateral, and ranking data.
6. Agent A decides whether to delegate, contract, insure, or reject the counterparty.

## Why This Matters

This turns AXP into a trust oracle pattern rather than a marketplace-only
pattern. Agents do not need to visit AXP manually. They encounter AXP whenever
they inspect another agent's manifest before taking economic risk.
