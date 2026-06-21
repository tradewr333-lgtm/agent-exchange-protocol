import assert from 'node:assert';
import { sampleTaskFor, SAMPLE_TASKS, SAMPLE_SERVICES } from '../src/sample-tasks.js';

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed += 1; };

// Every template service has at least one rich task with a real payload.
for (const svc of ['translation', 'code_review', 'research', 'data_processing', 'lead_generation']) {
  ok(Array.isArray(SAMPLE_TASKS[svc]) && SAMPLE_TASKS[svc].length > 0, `${svc} has sample tasks`);
  const t = sampleTaskFor(svc);
  ok(t.title && t.title.length > 5, `${svc} task has a title`);
  ok(t.description && t.description.length > 40, `${svc} task carries a real payload (not just a title)`);
  ok(t.service === svc, `${svc} task tagged with its service`);
}

// Unknown service falls back to a generic task (never throws / never empty).
const generic = sampleTaskFor('totally_unknown');
ok(generic.title && generic.description, 'unknown service -> generic task');
ok(generic.service === 'totally_unknown', 'generic task keeps requested service');

// SAMPLE_SERVICES is the key list and drives the feed coverage.
ok(SAMPLE_SERVICES.includes('translation') && SAMPLE_SERVICES.includes('code_review'), 'SAMPLE_SERVICES covers template services');

console.log(`sample-tasks.test.mjs: ${passed} checks passed`);
