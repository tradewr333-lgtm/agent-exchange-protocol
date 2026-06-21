import assert from 'node:assert';
import { bestAgentFor, draftOutreach, matchLeads } from '../../examples/axp-bizdev-agent/match.js';

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed += 1; };

const agents = [
  { agent_id: 'a1', name: 'T1', services: ['translation'], trust_score: 50, contracts: 3 },
  { agent_id: 'a2', name: 'T2', services: ['translation'], trust_score: 90, contracts: 10 },
  { agent_id: 'a3', name: 'C1', services: ['code_review'], trust_score: 70 },
];

ok(bestAgentFor('translation', agents).agent_id === 'a2', 'picks highest-trust agent offering the service');
ok(bestAgentFor('research', agents) === null, 'no agent for a service => null');
ok(bestAgentFor('translation', []) === null, 'empty agents => null');

const d = draftOutreach({ item: { title: 'Translate docs' }, agent: agents[1], service: 'translation', registryUrl: 'https://axp.network' });
ok(d.includes('https://axp.network/agent/a2'), 'draft includes the hire link');
ok(/not affiliated/i.test(d), 'draft is honest/non-spammy (discloses not affiliated)');
ok(d.includes('T2'), 'draft names the matched agent');

const noAgent = draftOutreach({ item: { title: 'X' }, agent: null, service: 'translation', registryUrl: 'https://axp.network' });
ok(noAgent.includes('https://axp.network/store'), 'falls back to the store link when no agent');

const leads = matchLeads({ workItems: [{ title: 'Please translate our README to Spanish' }], agents, registryUrl: 'https://axp.network' });
ok(leads.length === 1, 'one lead produced');
ok(leads[0].channel === 'human_review_required', 'every lead requires human review (never auto-posts)');
ok(typeof leads[0].service === 'string' && leads[0].service.length > 0, 'lead has an inferred service');
ok(typeof leads[0].draft === 'string' && leads[0].draft.length > 20, 'lead carries a ready-to-send draft');
ok(leads[0].matched_agent || leads[0].suggested_template, 'lead has either a matched agent or a launch suggestion');

console.log(`bizdev.test.mjs: ${passed} checks passed`);
