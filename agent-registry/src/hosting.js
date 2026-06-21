// AXP hosting reconciler — OWNER-scoped, slot-based auto-hosting.
//
// A subscription grants an owner N slots (Starter 1 / Pro 5 / Trust API 100).
// The backend identifies that owner's launched agents and keeps the most
// valuable ones HOSTED (active) up to the slot limit — automatically, with no
// per-agent checkout. This is the single source of truth for "who is hosted".
//
// Pure-ish: all I/O goes through the store. Safe to call repeatedly (idempotent).

import { loadAgentsRegistry, loadSubscriptions, updateAgentFields } from './store.js';
import { slotsForSku } from './billing.js';

const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

const norm = (s) => String(s ?? '').trim().toLowerCase();

// Highest slot entitlement across an owner's active subscriptions.
export async function ownerEntitlement(ownerRef, subs = null) {
  const owner = norm(ownerRef);
  if (!owner) return { slots: 0, plan: null };
  const all = subs ?? (await loadSubscriptions());
  let slots = 0;
  let plan = null;
  for (const s of all) {
    if (norm(s.owner_ref) !== owner) continue;
    if (!ACTIVE_STATUSES.has(norm(s.status))) continue;
    const n = slotsForSku(s.plan_sku);
    if (n > slots) { slots = n; plan = s.plan_sku; }
  }
  return { slots, plan };
}

// Decide which of an owner's agents should be hosted, given a slot budget.
// Priority: already-hosted first, then highest trust, then newest. Pure.
export function planHosting(agents, slots, plan) {
  const mine = (agents || []).filter((a) => a && a.origin === 'launch');
  const ranked = [...mine].sort((a, b) => {
    const ah = a.hosting?.active ? 1 : 0;
    const bh = b.hosting?.active ? 1 : 0;
    if (ah !== bh) return bh - ah;
    const at = Number(a.trust_score ?? a.trust?.score ?? 0);
    const bt = Number(b.trust_score ?? b.trust?.score ?? 0);
    if (at !== bt) return bt - at;
    return Date.parse(b.created_at ?? 0) - Date.parse(a.created_at ?? 0);
  });
  const changes = [];
  ranked.forEach((a, i) => {
    const shouldHost = i < slots;
    const cur = a.hosting || {};
    const sameState = Boolean(cur.active) === shouldHost
      && (shouldHost ? cur.plan === plan : true);
    if (!sameState) {
      changes.push({
        agent_id: a.agent_id,
        active: shouldHost,
        hosting: shouldHost
          ? { status: 'active', active: true, plan, source: 'owner_subscription', synced_at: new Date().toISOString() }
          : { status: 'inactive', active: false, plan: null, source: 'owner_subscription', synced_at: new Date().toISOString() },
      });
    }
  });
  return { hosted: Math.min(ranked.length, slots), total: ranked.length, changes };
}

// Reconcile a single owner: auto-host their agents up to their plan's slots.
export async function reconcileHosting(ownerRef) {
  const owner = norm(ownerRef);
  if (!owner) return { ok: false, reason: 'no_owner' };
  const subs = await loadSubscriptions();
  const { slots, plan } = await ownerEntitlement(owner, subs);
  const reg = await loadAgentsRegistry();
  const mine = (reg.agents || []).filter((a) => norm(a.owner) === owner);
  const result = planHosting(mine, slots, plan);
  for (const c of result.changes) {
    await updateAgentFields(c.agent_id, { hosting: c.hosting });
  }
  return { ok: true, owner, slots, plan, hosted: result.hosted, total: result.total, changed: result.changes.length };
}

// Reconcile every owner that has at least one (active) subscription.
export async function reconcileAllHosting() {
  const subs = await loadSubscriptions();
  const owners = [...new Set(
    subs.filter((s) => ACTIVE_STATUSES.has(norm(s.status)) && s.owner_ref)
      .map((s) => norm(s.owner_ref)),
  )];
  const results = [];
  for (const o of owners) {
    try { results.push(await reconcileHosting(o)); } catch (err) { results.push({ ok: false, owner: o, error: String(err?.message || err) }); }
  }
  return { owners: owners.length, results };
}
