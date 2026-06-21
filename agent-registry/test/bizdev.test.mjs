import assert from 'node:assert';
import { bestAgentFor, draftOutreach, matchLeads, buildLead, prioritize, fitScore } from '../../examples/axp-bizdev-agent/match.js';
import { parseBountyAmount } from '../../examples/axp-bizdev-agent/algora.js';

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

// --- minimum-trust filter (no offering trust-0 stubs) ---
ok(bestAgentFor('translation', agents, 60).agent_id === 'a2', 'minTrust keeps only agents above the floor');
ok(bestAgentFor('translation', agents, 95) === null, 'minTrust above all => null (suggest launch instead)');

// --- buildLead + fit score + prioritization ---
const stubs = [{ agent_id: 's1', name: 'Stub', services: ['research'], trust_score: 0 }];
const leadNoTrust = buildLead({ item: { title: 'Research X' }, service: 'research', agents: stubs, minTrust: 1, registryUrl: 'https://axp.network' });
ok(leadNoTrust.matched_agent === null && leadNoTrust.suggested_template === 'research', 'trust-0 stub is not matched; suggests launching');
ok(leadNoTrust.fit_score === 10, 'unmatched lead has low fit score');

const leadGood = buildLead({ item: { title: 'Research Y' }, service: 'research', summary: 'summarize the docs', agents: [{ agent_id: 'r1', name: 'R', services: ['research'], trust_score: 200 }], minTrust: 1, registryUrl: 'https://axp.network' });
ok(leadGood.matched_agent && leadGood.fit_score === 300, 'matched lead scores 100 + trust');
ok(leadGood.draft.includes('Specifically: summarize the docs'), 'Claude summary woven into the draft');

const ordered = prioritize([leadNoTrust, leadGood]);
ok(ordered[0] === leadGood, 'prioritize ranks the high-fit lead first');
ok(typeof fitScore(leadGood) === 'number', 'fitScore exported');

// --- Algora bounty parsing + paid-lead prioritization ---
ok(parseBountyAmount('💎 $500 bounty') === 500, 'parses $500');
ok(parseBountyAmount('reward: $1.5k') === 1500, 'parses $1.5k -> 1500');
ok(parseBountyAmount('$2,000 prize') === 2000, 'parses $2,000');
ok(parseBountyAmount('no money here') === 0, 'no amount -> 0');

const paid = buildLead({ item: { title: 'Fix bug', reward_usd: 500, source: 'algora', url: 'https://gh/9' }, service: 'code_review', agents: [{ agent_id: 'c1', name: 'C', services: ['code_review'], trust_score: 100 }], minTrust: 1, registryUrl: 'https://axp.network' });
ok(paid.reward_usd === 500 && paid.source === 'algora', 'lead carries reward + source');
ok(paid.draft.includes('$500 bounty'), 'draft mentions the bounty amount');
const unpaid = buildLead({ item: { title: 'Fix bug 2' }, service: 'code_review', agents: [{ agent_id: 'c1', name: 'C', services: ['code_review'], trust_score: 100 }], minTrust: 1, registryUrl: 'https://axp.network' });
ok(paid.fit_score > unpaid.fit_score, 'paid bounty ranks above an unpaid task');

console.log(`bizdev.test.mjs: ${passed} checks passed`);
