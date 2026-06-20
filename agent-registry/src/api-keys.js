import { createHash, randomBytes } from 'node:crypto';
import { buildAuthMessage } from './auth.js';
import { appendApiUsage, loadApiKeyRegistry, saveApiKeyRegistry } from './store.js';

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const KEY_ID_PATTERN = /^ak_[a-zA-Z0-9]{16}$/;
const API_KEY_PREFIX = 'axp_live_';
const RATE_LIMIT_TIERS = {
  free_developer: 1000,
  agent: 10000,
  verified_agent: 100000,
  partner: 1000000,
};

export async function registerApiKey(payload = {}) {
  const validation = validateApiKeyRegistration(payload);
  if (!validation.ok) {
    return validation;
  }

  const scope = buildApiKeyScope(payload);
  const authResult = await verifyApiKeyOwnerAuth({
    action: 'api_keys.register',
    owner: payload.owner,
    agentId: payload.auth.agent_id,
    auth: payload.auth,
    scope,
  });
  if (!authResult.ok) {
    return authResult;
  }

  const registry = await loadApiKeyRegistry();
  const now = new Date().toISOString();
  const secret = createApiKeySecret();
  const tier = normalizeTier(payload.tier, payload);
  const dailyLimit = normalizeDailyLimit(payload.daily_limit, tier);
  const key = {
    key_id: createKeyId(),
    name: payload.name,
    owner: normalizeAddress(payload.owner),
    agent_id: payload.agent_id ?? null,
    framework: payload.framework ?? null,
    tier,
    status: 'active',
    scopes: normalizeScopes(payload.scopes),
    rate_limit: {
      requests_per_day: dailyLimit,
      window: 'daily_utc',
      enforcement: 'active',
    },
    usage: {
      total_requests: 0,
      trust_score_requests: 0,
      risk_report_requests: 0,
      best_agent_requests: 0,
      trust_ranking_requests: 0,
      agent_query_requests: 0,
      last_used_at: null,
    },
    daily_usage: createDailyUsage(0, dailyLimit, tier),
    created_at: now,
    rotated_at: null,
    secret_hash: hashApiKey(secret),
    registration: {
      method: 'wallet_signed_api_key_registration',
      signer: authResult.signer,
      nonce: authResult.auth.nonce,
      issued_at: authResult.auth.issued_at,
      scope,
    },
  };

  const updatedRegistry = await saveApiKeyRegistry({
    ...registry,
    keys: [...registry.keys, key],
  });

  return {
    ok: true,
    status: 201,
    api_key: publicApiKey(key),
    secret,
    note: 'Store this API key now. It is returned only once.',
    registry: registrySummary(updatedRegistry),
  };
}

export async function getApiKey(keyId) {
  const registry = await loadApiKeyRegistry();
  const key = registry.keys.find((item) => item.key_id === keyId);
  return key ? publicApiKey(key) : null;
}

export async function rotateApiKey(keyId, payload = {}) {
  const registry = await loadApiKeyRegistry();
  const key = registry.keys.find((item) => item.key_id === keyId);
  if (!key) {
    return { ok: false, status: 404, error: 'api_key_not_found', key_id: keyId };
  }

  const validation = validateRotatePayload(payload);
  if (!validation.ok) {
    return validation;
  }

  const scope = `api_key:${keyId}|owner:${key.owner}|rotate:true`;
  const authResult = await verifyApiKeyOwnerAuth({
    action: 'api_keys.rotate',
    owner: key.owner,
    agentId: payload.auth.agent_id,
    auth: payload.auth,
    scope,
  });
  if (!authResult.ok) {
    return authResult;
  }

  const secret = createApiKeySecret();
  const updatedKey = {
    ...key,
    rotated_at: new Date().toISOString(),
    secret_hash: hashApiKey(secret),
    rotation: {
      signer: authResult.signer,
      nonce: authResult.auth.nonce,
      issued_at: authResult.auth.issued_at,
      scope,
    },
  };
  const updatedRegistry = await saveApiKeyRegistry({
    ...registry,
    keys: registry.keys.map((item) => (item.key_id === keyId ? updatedKey : item)),
  });

  return {
    ok: true,
    status: 200,
    api_key: publicApiKey(updatedKey),
    secret,
    note: 'Store this rotated API key now. It is returned only once.',
    registry: registrySummary(updatedRegistry),
  };
}

export async function requireApiKey(request, usageType, context = {}) {
  const rawKey = request.headers['x-axp-api-key'];
  if (!rawKey || typeof rawKey !== 'string') {
    return {
      ok: false,
      status: 401,
      error: 'api_key_required',
      header: 'X-AXP-API-Key',
      register_endpoint: 'POST /api-keys/register',
    };
  }

  const registry = await loadApiKeyRegistry();
  const keyHash = hashApiKey(rawKey);
  const key = registry.keys.find((item) => item.secret_hash === keyHash);
  if (!key || key.status !== 'active') {
    return { ok: false, status: 401, error: 'api_key_invalid_or_inactive' };
  }

  const rate = evaluateRateLimit(key);
  if (!rate.allowed) {
    await appendApiUsage({
      key_id: key.key_id,
      usage_type: 'rate_limited',
      agent_id: key.agent_id ?? context.agent_id ?? null,
      path: context.path ?? null,
      framework: key.framework ?? null,
      rate_limit: rate.public,
    });

    return {
      ok: false,
      status: 429,
      error: 'api_key_rate_limit_exceeded',
      key_id: key.key_id,
      rate_limit: rate.public,
      headers: buildRateLimitHeaders(rate.public),
    };
  }

  const updatedKey = recordUsage(key, usageType, rate);
  await saveApiKeyRegistry({
    ...registry,
    keys: registry.keys.map((item) => (item.key_id === updatedKey.key_id ? updatedKey : item)),
  });
  await appendApiUsage({
    key_id: updatedKey.key_id,
    usage_type: usageType,
    agent_id: updatedKey.agent_id ?? context.agent_id ?? null,
    path: context.path ?? null,
    framework: updatedKey.framework ?? null,
    rate_limit: updatedKey.daily_usage,
  });

  return {
    ok: true,
    key: publicApiKey(updatedKey),
    rate_limit: updatedKey.daily_usage,
    headers: buildRateLimitHeaders(updatedKey.daily_usage),
  };
}

export function buildApiKeyScope(payload) {
  return [
    `api_key:${payload.name}`,
    `owner:${payload.owner}`,
    `agent:${payload.agent_id ?? 'none'}`,
    `framework:${payload.framework ?? 'none'}`,
  ].join('|');
}

function validateApiKeyRegistration(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, status: 400, error: 'invalid_json_body' };
  }

  if (!payload.name || typeof payload.name !== 'string' || payload.name.length > 80) {
    return { ok: false, status: 400, error: 'name_required' };
  }

  if (!payload.owner || typeof payload.owner !== 'string' || !ADDRESS_PATTERN.test(payload.owner)) {
    return { ok: false, status: 400, error: 'owner_invalid' };
  }

  if (payload.agent_id !== undefined && typeof payload.agent_id !== 'string') {
    return { ok: false, status: 400, error: 'agent_id_invalid' };
  }

  if (payload.framework !== undefined && typeof payload.framework !== 'string') {
    return { ok: false, status: 400, error: 'framework_invalid' };
  }

  if (payload.tier !== undefined && typeof payload.tier !== 'string') {
    return { ok: false, status: 400, error: 'tier_invalid' };
  }

  if (payload.daily_limit !== undefined) {
    const dailyLimit = Number(payload.daily_limit);
    if (!Number.isFinite(dailyLimit) || dailyLimit <= 0) {
      return { ok: false, status: 400, error: 'daily_limit_invalid' };
    }
  }

  if (!payload.auth || typeof payload.auth !== 'object') {
    return { ok: false, status: 401, error: 'auth_required' };
  }

  return { ok: true };
}

function validateRotatePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, status: 400, error: 'invalid_json_body' };
  }

  if (!payload.auth || typeof payload.auth !== 'object') {
    return { ok: false, status: 401, error: 'auth_required' };
  }

  return { ok: true };
}

async function verifyApiKeyOwnerAuth({ action, owner, agentId, auth, scope }) {
  for (const field of ['agent_id', 'address', 'signature', 'nonce', 'issued_at']) {
    if (!auth[field] || typeof auth[field] !== 'string') {
      return { ok: false, status: 401, error: `auth_${field}_required` };
    }
  }

  if (!sameAddress(auth.address, owner)) {
    return { ok: false, status: 401, error: 'auth_owner_mismatch' };
  }

  const issuedAtMs = Date.parse(auth.issued_at);
  if (!Number.isFinite(issuedAtMs) || Math.abs(Date.now() - issuedAtMs) > 10 * 60 * 1000) {
    return { ok: false, status: 401, error: 'auth_timestamp_expired' };
  }

  const message = buildAuthMessage({
    action,
    agentId,
    address: auth.address,
    nonce: auth.nonce,
    issuedAt: auth.issued_at,
    scope,
  });

  try {
    const { verifyMessage } = await import('ethers');
    const recovered = verifyMessage(message, auth.signature);
    if (!sameAddress(recovered, owner)) {
      return { ok: false, status: 401, error: 'invalid_signature' };
    }
  } catch {
    return { ok: false, status: 503, error: 'signature_verifier_unavailable' };
  }

  return {
    ok: true,
    signer: normalizeAddress(owner),
    message,
    auth: {
      agent_id: auth.agent_id,
      address: auth.address,
      nonce: auth.nonce,
      issued_at: auth.issued_at,
    },
  };
}

function recordUsage(key, usageType, rate) {
  const usage = {
    ...key.usage,
    total_requests: Number(key.usage?.total_requests ?? 0) + 1,
    last_used_at: new Date().toISOString(),
  };

  const counter = `${usageType}_requests`;
  if (Object.hasOwn(usage, counter)) {
    usage[counter] = Number(usage[counter] ?? 0) + 1;
  }

  return {
    ...key,
    usage,
    daily_usage: {
      ...rate.public,
      used: rate.public.used + 1,
      remaining: Math.max(rate.public.remaining - 1, 0),
    },
  };
}

function publicApiKey(key) {
  const { secret_hash: _secretHash, ...publicKey } = key;
  return publicKey;
}

function registrySummary(registry) {
  return {
    schema: registry.schema,
    network: registry.network,
    updated_at: registry.updated_at,
    count: registry.keys.length,
  };
}

function createKeyId() {
  return `ak_${randomBytes(8).toString('hex')}`;
}

function createApiKeySecret() {
  return `${API_KEY_PREFIX}${randomBytes(24).toString('hex')}`;
}

function evaluateRateLimit(key) {
  const tier = normalizeStoredTier(key);
  const limit = normalizeDailyLimit(key.rate_limit?.requests_per_day ?? key.daily_limit, tier);
  const currentWindow = dailyWindowKey();
  const resetAt = dailyResetAt();
  const dailyUsage = key.daily_usage?.window === currentWindow
    ? createDailyUsage(key.daily_usage.used ?? 0, limit, tier, currentWindow, resetAt)
    : createDailyUsage(0, limit, tier, currentWindow, resetAt);
  const used = Number(dailyUsage.used ?? 0);

  return {
    allowed: used < limit,
    public: {
      tier,
      limit,
      used,
      remaining: Math.max(limit - used, 0),
      window: currentWindow,
      reset_at: resetAt,
    },
  };
}

function normalizeStoredTier(key) {
  const tier = String(key.tier ?? '').toLowerCase();
  if (Object.hasOwn(RATE_LIMIT_TIERS, tier)) {
    return tier;
  }

  return key.agent_id ? 'agent' : 'free_developer';
}

function createDailyUsage(used = 0, limit = RATE_LIMIT_TIERS.free_developer, tier = 'free_developer', window = dailyWindowKey(), resetAt = dailyResetAt()) {
  return {
    tier,
    limit,
    used: Number(used),
    remaining: Math.max(Number(limit) - Number(used), 0),
    window,
    reset_at: resetAt,
  };
}

function normalizeTier(value, payload = {}) {
  const tier = String(value ?? '').toLowerCase();
  const adminToken = payload.admin_rate_limit_token ?? null;
  const adminAllowed = process.env.AXP_RATE_LIMIT_ADMIN_TOKEN
    && adminToken
    && String(adminToken) === String(process.env.AXP_RATE_LIMIT_ADMIN_TOKEN);

  if (tier === 'free_developer') {
    return tier;
  }

  if (tier === 'agent' && payload.agent_id) {
    return tier;
  }

  if (['verified_agent', 'partner'].includes(tier) && adminAllowed) {
    return tier;
  }

  return payload.agent_id ? 'agent' : 'free_developer';
}

function normalizeDailyLimit(value, tier) {
  const customLimit = Number(value);
  if (tier === 'partner' && Number.isFinite(customLimit) && customLimit > 0) {
    return Math.trunc(customLimit);
  }

  return RATE_LIMIT_TIERS[tier] ?? RATE_LIMIT_TIERS.free_developer;
}

function dailyWindowKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function dailyResetAt(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)).toISOString();
}

function buildRateLimitHeaders(rateLimit) {
  return {
    'X-AXP-RateLimit-Limit': String(rateLimit.limit),
    'X-AXP-RateLimit-Remaining': String(rateLimit.remaining),
    'X-AXP-RateLimit-Reset': rateLimit.reset_at,
    'X-AXP-RateLimit-Tier': rateLimit.tier,
  };
}

function hashApiKey(secret) {
  return createHash('sha256').update(secret).digest('hex');
}

function normalizeScopes(scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    return ['trust:read'];
  }

  return [...new Set(scopes.map((scope) => String(scope).trim()).filter(Boolean))];
}

function normalizeAddress(address) {
  return String(address).toLowerCase();
}

function sameAddress(left, right) {
  return String(left).toLowerCase() === String(right).toLowerCase();
}
