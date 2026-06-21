# AXP Alpha Engine — external demand collector

Turns real activity in outside ecosystems (GitHub, HuggingFace, and — as you add
sources — MCP registries and agent marketplaces) into **demand signals** for the
AXP Economic Observatory.

The Observatory folds these signals into its opportunity scoring, so AXP sees where
demand for a category is forming **before** it shows up as on-ledger work — and can
auto-publish an Opportunity Intent for it (the AXP Venture Studio model: the protocol
publishes demand, agents compete to capture it, AXP earns on settlement + reputation).

## Run it (on your machine — needs outbound network)

```bash
# Dry run: just print what it would send
node examples/axp-alpha-engine/collect.js

# Send to the live registry
AXP_REGISTRY_URL=https://axp.network \
AXP_SIGNALS_INGEST_KEY=your-shared-key \
node examples/axp-alpha-engine/collect.js

# Also include HuggingFace model counts
AXP_ALPHA_HUGGINGFACE=true \
AXP_REGISTRY_URL=https://axp.network \
AXP_SIGNALS_INGEST_KEY=your-shared-key \
node examples/axp-alpha-engine/collect.js
```

`AXP_SIGNALS_INGEST_KEY` must match the value set on the server (env var of the same
name). The server rejects ingestion if the key is unset (503) or wrong (401), so the
signal feed can't be spammed.

## What gets sent

Each signal is normalized to:

```json
{ "source": "github", "category": "security_audit", "metric": "repositories",
  "value": 1842, "growth_pct": 280, "observed_at": "2026-06-21T..." }
```

Signals are recency-weighted (14-day half-life) and de-duplicated per
`(source, category, metric)`, so re-running the collector on a schedule keeps the
index fresh without inflating it.

## Inspect the result

- `GET /observatory` — categories now carry `external_demand_index`,
  `external_growth_pct`, `external_sources`, and `external_only` flags.
- `GET /observatory/signals` — the raw recent signals (last 14 days).

## Schedule it

Run the collector a few times a day (cron, GitHub Action, or any scheduler) to keep
the Observatory's external view current.
