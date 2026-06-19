import { getAgent } from './registry.js';

const AUTH_WINDOW_MS = 10 * 60 * 1000;

export function buildAuthMessage({ action, agentId, address, nonce, issuedAt, scope }) {
  return [
    'AXP Agent Authorization',
    `Action: ${action}`,
    `Agent ID: ${agentId}`,
    `Operator: ${address}`,
    `Scope: ${scope}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join('\n');
}

export async function verifyAgentAuth({ action, agentId, auth, scope }) {
  const agent = getAgent(agentId);
  if (!agent) {
    return { ok: false, status: 404, error: 'auth_agent_not_found' };
  }

  const expectedOperator = getAgentOperator(agent);
  if (!expectedOperator) {
    return { ok: false, status: 401, error: 'agent_operator_not_configured', agent_id: agentId };
  }

  const validation = validateAuthShape(auth);
  if (!validation.ok) {
    return validation;
  }

  if (auth.agent_id !== agentId) {
    return { ok: false, status: 401, error: 'auth_agent_mismatch' };
  }

  if (!sameAddress(auth.address, expectedOperator)) {
    return { ok: false, status: 401, error: 'auth_operator_mismatch' };
  }

  const issuedAtMs = Date.parse(auth.issued_at);
  if (!Number.isFinite(issuedAtMs) || Math.abs(Date.now() - issuedAtMs) > AUTH_WINDOW_MS) {
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
    if (!sameAddress(recovered, expectedOperator)) {
      return { ok: false, status: 401, error: 'invalid_signature' };
    }
  } catch {
    return { ok: false, status: 503, error: 'signature_verifier_unavailable' };
  }

  return {
    ok: true,
    signer: expectedOperator,
    message,
    auth: {
      agent_id: agentId,
      address: auth.address,
      nonce: auth.nonce,
      issued_at: auth.issued_at,
    },
  };
}

export function getAgentOperator(agent) {
  return agent?.manifest?.onchain?.operator ?? null;
}

function validateAuthShape(auth) {
  if (!auth || typeof auth !== 'object') {
    return { ok: false, status: 401, error: 'auth_required' };
  }

  for (const field of ['agent_id', 'address', 'signature', 'nonce', 'issued_at']) {
    if (!auth[field] || typeof auth[field] !== 'string') {
      return { ok: false, status: 401, error: `auth_${field}_required` };
    }
  }

  return { ok: true };
}

function sameAddress(left, right) {
  return String(left).toLowerCase() === String(right).toLowerCase();
}
