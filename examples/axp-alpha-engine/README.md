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

`AXP_SIGNALS_INGEST_KEY` must match the value set **on the server** (env var of the
same name, e.g. in Render → Environment). The server rejects ingestion if the key is
unset (**503 `signal_ingest_disabled`**) or wrong (**401**), so the feed can't be
spammed. Setting it only in your local shell is not enough — the server validates it.

### Avoid GitHub rate limits (recommended)

Unauthenticated GitHub Search is capped at ~10 requests/min, so a full run will hit
`403 rate limit exceeded`. Set a `GITHUB_TOKEN` (any classic/fine-grained PAT, no
scopes needed for public search) to get 30 req/min **and** the growth metric:

```bash
GITHUB_TOKEN=ghp_xxx \
AXP_REGISTRY_URL=https://axp.network \
AXP_SIGNALS_INGEST_KEY=your-shared-key \
node examples/axp-alpha-engine/collect.js
```

Without a token the collector automatically slows down (1 request/category, no growth)
so it still completes.

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
