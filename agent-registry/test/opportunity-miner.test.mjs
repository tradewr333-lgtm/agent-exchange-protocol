// Tests for the Opportunity Miner: pure normalization + end-to-end publish flow.
// Run with: AXP_DATA_DIR=<tmp> node agent-registry/test/opportunity-miner.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.AXP_DATA_DIR;
assert.ok(dataDir, 'AXP_DATA_DIR must be set');
assert.ok(!process.env.DATABASE_URL, 'DATABASE_URL must be unset (JSON mode)');

mkdirSync(dataDir, { recursive: true });
const seedAgents = readFileSync(join(here, '..', 'data', 'agents.json'), 'utf8').replace(/^﻿/, '');
writeFileSync(join(dataDir, 'agents.json'), seedAgents);

const { inferService, inferUrgency, estimateReward, workItemToIntent } =
  await import('../../examples/axp-opportunity-miner/normalize.js');
const { runMiner } = await import('../../examples/axp-opportunity-miner/miner.js');
const { listIntents, publishIntent, getIntentFeed } = await import('../src/intents.js');
const { getOpportunityGraph } = await import('../src/opportunities.js');

let passed = 0;
function check(label, condition) {
  assert.ok(condition, label);
  passed += 1;
  console.log(`  PASS ${label}`);
}

console.log('AXP Opportunity Miner — test\n');

// --- Pure normalization ---------------------------------------------------
check('infers security_audit from audit keywords',
  inferService({ title: 'Audit Solana program', labels: ['security'] }).service === 'security_audit');
check('infers research', inferService({ title: 'Research agent frameworks' }).service === 'research');
check('infers translation', inferService({ title: 'Translate the docs' }).service === 'translation');
check('falls back to general', inferService({ title: 'Do a thing' }).service === 'general');
check('urgency CRITICAL on urgent/security', inferUrgency({ title: 'urgent fix', labels: ['security'] }) === 'CRITICAL');
check('reward fallback for good first issue', estimateReward({ labels: ['good first issue'] }) === 150);
check('explicit reward respected', estimateReward({ reward_usd: 2500 }) === 2500);

const intent = workItemToIntent({ title: 'Audit X', labels: ['security'], reward_usd: 5000, url: 'https://e.com/1' });
check('security audit intent requires trust', intent.min_trust_score === 1000);
check('intent carries source_uri for dedupe', intent.source_uri === 'https://e.com/1');
check('null for invalid item', workItemToIntent({}) === null);

// --- End-to-end via in-process client (JSON mode) -------------------------
const client = {
  listIntents: (f) => listIntents(f),
  publishIntent: async (i) => {
    const r = await publishIntent(i);
    if (!r.ok) throw new Error(JSON.stringify(r));
    return r.intent;
  },
};

const run1 = await runMiner({ client, source: 'sample', publish: true });
check('mined 5 sample items', run1.mined === 5);
check('published 5 new intents', run1.published === 5 && run1.new_intents === 5);

const feed = await getIntentFeed({ limit: 50 });
check('feed now has 5 intents', feed.count === 5);

const graph = await getOpportunityGraph({ limit: 50 });
check('research intent is matched to an agent', graph.suggested_matches.some((m) => m.service === 'research'));
check('security_audit (no specialist) is a spawn opportunity',
  graph.spawn_opportunities.some((s) => s.service === 'security_audit'));

// --- Dedupe: re-running mines nothing new ---------------------------------
const run2 = await runMiner({ client, source: 'sample', publish: true });
check('second run skips all as duplicates', run2.duplicates_skipped === 5 && run2.new_intents === 0);

console.log(`\nAll ${passed} checks passed.`);
