import assert from 'node:assert';
import { buildPrompt, llmEnabled, activeModel, executeTask } from '../src/agent-executor.js';

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed += 1; };

// buildPrompt: per-template system prompt + falls back to a sample task.
const research = buildPrompt('research', '');
ok(/research agent/i.test(research.system), 'research system prompt');
ok(research.usedSample === true && research.task.length > 0, 'falls back to sample task when none given');

const withTask = buildPrompt('translation', 'Translate hello to Spanish');
ok(withTask.usedSample === false && withTask.task === 'Translate hello to Spanish', 'uses provided task');
ok(/translation/i.test(withTask.system), 'translation system prompt');

const codereview = buildPrompt('code_review', '   ');
ok(codereview.usedSample === true, 'whitespace-only task falls back to sample');
ok(/code review/i.test(codereview.system), 'code_review system prompt');

// Unknown template falls back to research persona (safe default).
ok(/research agent/i.test(buildPrompt('nope', 'x').system), 'unknown template -> research default');

// All template ids have a tailored system prompt.
for (const t of ['research', 'translation', 'code_review', 'data_processing', 'leadgen',
  'security_audit', 'content_writing', 'analysis', 'customer_support', 'market_research']) {
  ok(buildPrompt(t, '').system.length > 20, `${t} has a system prompt`);
}
// The market_research prompt must carry the not-financial-advice guardrail.
ok(/not financial advice/i.test(buildPrompt('market_research', '').system), 'market_research has non-advice guardrail');

// Gating: without ANTHROPIC_API_KEY, executeTask declines gracefully (no network call).
const savedKey = process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
ok(llmEnabled() === false, 'llmEnabled false without key');
const declined = await executeTask({ template_id: 'research', task: 'hi' });
ok(declined.ok === false && declined.reason === 'llm_not_configured', 'executeTask declines without key');
if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;

// Model default + override.
delete process.env.ANTHROPIC_MODEL;
ok(activeModel().startsWith('claude-'), 'default model is a Claude model');
process.env.ANTHROPIC_MODEL = 'claude-test-x';
ok(activeModel() === 'claude-test-x', 'model overridable via env');
delete process.env.ANTHROPIC_MODEL;

console.log(`agent-executor.test.mjs: ${passed} checks passed`);
