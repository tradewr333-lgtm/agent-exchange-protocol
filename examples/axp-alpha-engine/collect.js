#!/usr/bin/env node
// AXP Alpha Engine collector.
//
// Scrapes PUBLIC external ecosystems for demand signals and POSTs them to the AXP
// Observatory, which folds them into its opportunity scoring and (optionally)
// auto-publishes Opportunity Intents for underserved, heating-up categories.
//
// Run on your machine (it needs outbound network; the registry sandbox has none):
//   AXP_REGISTRY_URL=https://axp.network \
//   AXP_SIGNALS_INGEST_KEY=your-shared-key \
//   node examples/axp-alpha-engine/collect.js
//
// AXP_SIGNALS_INGEST_KEY must match the value set on the server. Without
// AXP_REGISTRY_URL the collector just prints the signals (dry run).

import { CATEGORIES } from './categories.js';
import { githubSignal, huggingfaceSignal } from './sources.js';

const REGISTRY = process.env.AXP_REGISTRY_URL || '';
const INGEST_KEY = process.env.AXP_SIGNALS_INGEST_KEY || '';
const WITH_HF = process.env.AXP_ALPHA_HUGGINGFACE === 'true';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

// Unauthenticated GitHub Search allows ~10 req/min; a token raises it to 30/min.
// Without a token we do ONE request per category (no growth) and space them out so
// the run still completes. With a token we fetch growth too and run much faster.
const WITH_GROWTH = Boolean(GITHUB_TOKEN);
const GH_DELAY_MS = GITHUB_TOKEN ? 2500 : 9000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function collect() {
  if (!GITHUB_TOKEN) {
    console.log('No GITHUB_TOKEN set — running slow (1 req/category, no growth). Set GITHUB_TOKEN for 30 req/min + growth.\n');
  }
  const signals = [];
  for (const c of CATEGORIES) {
    try {
      const gh = await githubSignal(c.category, c.github, { token: GITHUB_TOKEN, withGrowth: WITH_GROWTH });
      signals.push(gh);
      console.log(`github   ${c.category.padEnd(18)} value=${gh.value} growth=${gh.growth_pct}%`);
      await sleep(GH_DELAY_MS);
      if (WITH_HF && c.hf) {
        const hf = await huggingfaceSignal(c.category, c.hf);
        if (hf) {
          signals.push(hf);
          console.log(`hf       ${c.category.padEnd(18)} value=${hf.value}`);
        }
        await sleep(1500);
      }
    } catch (err) {
      console.warn(`skip ${c.category}: ${err.message}`);
    }
  }
  return signals;
}

async function publish(signals) {
  if (!REGISTRY) {
    console.log('\nDry run (no AXP_REGISTRY_URL). Collected signals:');
    console.log(JSON.stringify(signals, null, 2));
    return;
  }
  const res = await fetch(`${REGISTRY.replace(/\/$/, '')}/observatory/signals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-axp-ingest-key': INGEST_KEY },
    body: JSON.stringify({ signals }),
  });
  const text = await res.text();
  console.log(`\nPOST /observatory/signals -> ${res.status} ${text}`);
  if (!res.ok) process.exitCode = 1;
}

const signals = await collect();
console.log(`\nCollected ${signals.length} signal(s).`);
await publish(signals);
