import { createHash, randomBytes } from 'node:crypto';
import { buildAuthMessage } from './auth.js';
import { appendApiUsage, loadApiKeyRegistry, saveApiKeyRegistry } from './store.js';

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const KEY_ID_PATTERN = /^ak_[a-zA-Z0-9]{16}$/;
const API_KEY_PREFIX = 'axp_live_';

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
  const key = {
    key_id: createKeyId(),
    name: payload.name,
    owner: normalizeAddress(payload.owner),
    agent_id: payload.agent_id ?? null,
    framework: payload.framework ?? null,
    status: 'active',
    scopes: normalizeScopes(payload.scopes),
    rate_limit: {
      requests_per_minute: Number(payload.requests_per_minute ?? 120),
      enforcement: 'planned',
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

  const updatedKey = recordUsage(key, usageType);
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
  });

  return {
    ok: true,
    key: publicApiKey(updatedKey),
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

function recordUsage(key, usageType) {
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
