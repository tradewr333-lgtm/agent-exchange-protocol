import assert from 'node:assert';
import { planHosting, ownerEntitlement, reconcileHosting } from '../src/hosting.js';
import { saveAgentsRegistry, saveSubscription, loadAgentsRegistry } from '../src/store.js';

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed += 1; };

// --- planHosting (pure) ---
const agents = [
  { agent_id: 'a1', origin: 'launch', trust_score: 10, created_at: '2026-01-01', hosting: { active: false } },
  { agent_id: 'a2', origin: 'launch', trust_score: 90, created_at: '2026-02-01', hosting: { active: false } },
  { agent_id: 'a3', origin: 'launch', trust_score: 50, created_at: '2026-03-01', hosting: { active: false } },
];

const p1 = planHosting(agents, 1, 'hosting_starter');
ok(p1.hosted === 1, '1 slot hosts 1 agent');
ok(p1.changes.find((c) => c.agent_id === 'a2' && c.active), 'highest trust (a2) is the one hosted');
ok(p1.changes.filter((c) => c.active).length === 1, 'exactly one activated');

const p2 = planHosting(agents, 5, 'trust_api');
ok(p2.hosted === 3 && p2.changes.filter((c) => c.active).length === 3, '5 slots host all 3 agents');

// non-launch agents are ignored
const p3 = planHosting([...agents, { agent_id: 'sys', origin: 'system', hosting: { active: false } }], 0, null);
ok(p3.total === 3, 'only launch-origin agents counted');
ok(p3.changes.every((c) => !c.active), '0 slots => nothing hosted');

// already-hosted with same plan => no churn
const stable = [{ agent_id: 'a1', origin: 'launch', trust_score: 10, hosting: { active: true, plan: 'hosting_starter' } }];
ok(planHosting(stable, 1, 'hosting_starter').changes.length === 0, 'idempotent: no change when already correct');

// --- store-backed reconcile (needs AXP_DATA_DIR) ---
await saveAgentsRegistry({
  schema: 'axp.agents.v0',
  agents: [
    { agent_id: 'o1', origin: 'launch', owner: '0xOwnerAAA', trust_score: 30, created_at: '2026-01-01', hosting: { active: false } },
    { agent_id: 'o2', origin: 'launch', owner: '0xOwnerAAA', trust_score: 80, created_at: '2026-02-01', hosting: { active: false } },
    { agent_id: 'o3', origin: 'launch', owner: '0xOwnerAAA', trust_score: 60, created_at: '2026-03-01', hosting: { active: false } },
    { agent_id: 'x1', origin: 'launch', owner: '0xOTHER', trust_score: 99, created_at: '2026-01-01', hosting: { active: false } },
  ],
});
await saveSubscription({ id: 'sub_starter', owner_ref: '0xownerAAA', plan_sku: 'hosting_starter', status: 'active' });

const ent = await ownerEntitlement('0xOwnerAAA');
ok(ent.slots === 1 && ent.plan === 'hosting_starter', 'entitlement reads active starter sub (case-insensitive)');

const r1 = await reconcileHosting('0xOwnerAAA');
ok(r1.ok && r1.hosted === 1 && r1.total === 3, 'starter => 1 of 3 owner agents hosted');

let reg = await loadAgentsRegistry();
const hosted = reg.agents.filter((a) => a.owner === '0xOwnerAAA' && a.hosting?.active);
ok(hosted.length === 1 && hosted[0].agent_id === 'o2', 'highest-trust owner agent (o2) hosted');
ok(reg.agents.find((a) => a.agent_id === 'x1').hosting?.active !== true, 'other owner unaffected');

// upgrade to Trust API (100 slots) => all 3 hosted
await saveSubscription({ id: 'sub_scale', owner_ref: '0xOwnerAAA', plan_sku: 'trust_api', status: 'active' });
const r2 = await reconcileHosting('0xOwnerAAA');
ok(r2.slots === 100 && r2.hosted === 3, 'trust_api => all 3 hosted');
reg = await loadAgentsRegistry();
ok(reg.agents.filter((a) => a.owner === '0xOwnerAAA' && a.hosting?.active).length === 3, 'all owner agents now hosted');

// cancel => nothing hosted
await saveSubscription({ id: 'sub_starter', owner_ref: '0xOwnerAAA', plan_sku: 'hosting_starter', status: 'canceled' });
await saveSubscription({ id: 'sub_scale', owner_ref: '0xOwnerAAA', plan_sku: 'trust_api', status: 'canceled' });
const r3 = await reconcileHosting('0xOwnerAAA');
ok(r3.slots === 0 && r3.hosted === 0, 'all canceled => 0 hosted');
reg = await loadAgentsRegistry();
ok(reg.agents.filter((a) => a.owner === '0xOwnerAAA' && a.hosting?.active).length === 0, 'agents un-hosted after cancel');

console.log(`hosting.test.mjs: ${passed} checks passed`);
