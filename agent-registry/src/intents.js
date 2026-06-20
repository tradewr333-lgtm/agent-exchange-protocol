import { randomUUID } from 'node:crypto';
import { loadIntents, saveIntent } from './store.js';

export const INTENT_LAYER_VERSION = '0.1.0';

export const URGENCY_WEIGHT = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
const VALID_URGENCY = new Set(Object.keys(URGENCY_WEIGHT));
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Publish a machine-readable intent ("work that needs an agent").
export async function publishIntent(body = {}) {
  if (!body || typeof body !== 'object') {
    return { ok: false, status: 400, error: 'invalid_json_body' };
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) {
    return { ok: false, status: 400, error: 'title_required' };
  }

  const urgency = normalizeUrgency(body.urgency);
  const now = new Date();
  const ttlMs = Number.isFinite(Number(body.ttl_ms)) && Number(body.ttl_ms) > 0
    ? Number(body.ttl_ms)
    : DEFAULT_TTL_MS;
  const expiresAt = body.expires_at ?? new Date(now.getTime() + ttlMs).toISOString();

  const intent = {
    schema: 'axp.intent.v0',
    intent_id: `intent_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    title,
    description: typeof body.description === 'string' ? body.description : '',
    service: body.service ?? null,
    skills: Array.isArray(body.skills) ? body.skills.filter((s) => typeof s === 'string') : [],
    reward_usd: nonNegative(body.reward_usd),
    currency: body.currency ?? 'USD',
    urgency,
    required_capacity_usd: nonNegative(body.required_capacity_usd),
    min_trust_score: Number.isFinite(Number(body.min_trust_score)) ? Number(body.min_trust_score) : 0,
    source: body.source ?? 'manual',
    source_uri: body.source_uri ?? null,
    requester: body.requester ?? null,
    status: 'open',
    claimed_by: null,
    claimed_at: null,
    fulfilled_at: null,
    metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    expires_at: expiresAt,
  };

  await saveIntent(intent);
  return { ok: true, status: 201, intent };
}

export async function listIntents(filters = {}) {
  const intents = (await loadIntents()).map(withEffectiveStatus);
  let filtered = intents;

  if (filters.status) {
    filtered = filtered.filter((intent) => intent.status === filters.status);
  }
  if (filters.service) {
    filtered = filtered.filter((intent) => intent.service === filters.service);
  }
  if (filters.urgency) {
    const urgency = normalizeUrgency(filters.urgency);
    filtered = filtered.filter((intent) => intent.urgency === urgency);
  }
  if (filters.requester) {
    filtered = filtered.filter((intent) => intent.requester === filters.requester);
  }

  filtered = sortByPriority(filtered);
  const limit = normalizeLimit(filters.limit, 200);

  return {
    protocol: 'AXP',
    version: INTENT_LAYER_VERSION,
    schema: 'axp.intent_list.v0',
    count: Math.min(filtered.length, limit),
    total: filtered.length,
    filters: {
      status: filters.status ?? null,
      service: filters.service ?? null,
      urgency: filters.urgency ? normalizeUrgency(filters.urgency) : null,
      limit,
    },
    intents: filtered.slice(0, limit),
  };
}

// GET /intents/live — the feed agents poll all day.
export async function getIntentFeed(filters = {}) {
  const limit = normalizeLimit(filters.limit, 50);
  const intents = sortByPriority(
    (await loadIntents()).map(withEffectiveStatus).filter((intent) => intent.status === 'open'),
  ).slice(0, limit);

  return {
    protocol: 'AXP',
    version: INTENT_LAYER_VERSION,
    schema: 'axp.intent_feed.v0',
    generated_at: new Date().toISOString(),
    count: intents.length,
    note: 'Machine-readable executable work. Poll this feed; claim with POST /intents/{intent_id}/claim.',
    intents: intents.map(toFeedEntry),
  };
}

export async function getIntent(intentId) {
  const intents = await loadIntents();
  const intent = intents.find((item) => item.intent_id === intentId);
  return intent ? withEffectiveStatus(intent) : null;
}

export async function claimIntent(intentId, body = {}) {
  const agentId = typeof body.agent_id === 'string' ? body.agent_id.trim() : '';
  if (!agentId) {
    return { ok: false, status: 400, error: 'agent_id_required' };
  }

  const intents = await loadIntents();
  const intent = intents.find((item) => item.intent_id === intentId);
  if (!intent) {
    return { ok: false, status: 404, error: 'intent_not_found', intent_id: intentId };
  }

  const effective = withEffectiveStatus(intent);
  if (effective.status === 'expired') {
    return { ok: false, status: 409, error: 'intent_expired', intent_id: intentId };
  }
  if (intent.status === 'claimed' && intent.claimed_by && intent.claimed_by !== agentId) {
    return { ok: false, status: 409, error: 'intent_already_claimed', claimed_by: intent.claimed_by };
  }
  if (intent.status === 'fulfilled') {
    return { ok: false, status: 409, error: 'intent_already_fulfilled' };
  }

  const updated = {
    ...intent,
    status: 'claimed',
    claimed_by: agentId,
    claimed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await saveIntent(updated);
  return { ok: true, status: 200, intent: updated };
}

export async function fulfillIntent(intentId, body = {}) {
  const intents = await loadIntents();
  const intent = intents.find((item) => item.intent_id === intentId);
  if (!intent) {
    return { ok: false, status: 404, error: 'intent_not_found', intent_id: intentId };
  }

  const updated = {
    ...intent,
    status: 'fulfilled',
    fulfilled_by: body.agent_id ?? intent.claimed_by ?? null,
    contract_id: body.contract_id ?? intent.contract_id ?? null,
    fulfilled_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await saveIntent(updated);
  return { ok: true, status: 200, intent: updated };
}

export function intentPriorityScore(intent) {
  const urgency = URGENCY_WEIGHT[intent.urgency] ?? 2;
  const reward = Math.log10(Math.max(1, Number(intent.reward_usd) || 0) + 1);
  const ageHours = (Date.now() - Date.parse(intent.created_at ?? '')) / 3_600_000;
  const freshness = Number.isFinite(ageHours) ? Math.max(0, 1 - ageHours / 168) : 0;
  return Number((urgency * 10 + reward * 5 + freshness * 3).toFixed(4));
}

function toFeedEntry(intent) {
  return {
    intent_id: intent.intent_id,
    title: intent.title,
    service: intent.service,
    skills: intent.skills,
    reward: Number(intent.reward_usd) || 0,
    currency: intent.currency ?? 'USD',
    urgency: intent.urgency,
    required_capacity_usd: Number(intent.required_capacity_usd) || 0,
    min_trust_score: Number(intent.min_trust_score) || 0,
    source: intent.source,
    priority_score: intentPriorityScore(intent),
    expires_at: intent.expires_at,
    claim_url: `/intents/${intent.intent_id}/claim`,
  };
}

function withEffectiveStatus(intent) {
  if (intent.status === 'open' && intent.expires_at && Date.parse(intent.expires_at) < Date.now()) {
    return { ...intent, status: 'expired' };
  }
  return intent;
}

function sortByPriority(intents) {
  return [...intents].sort((left, right) => intentPriorityScore(right) - intentPriorityScore(left));
}

function normalizeUrgency(value) {
  const upper = typeof value === 'string' ? value.toUpperCase() : '';
  return VALID_URGENCY.has(upper) ? upper : 'MEDIUM';
}

function nonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function normalizeLimit(value, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }
  return Math.min(Math.trunc(number), 500);
}
