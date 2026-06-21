// Shared helper: mint an AXP API key by signing locally with an operator wallet.
// Used by mint-api-key.js (prints it) and anchor-bsc.js (uses it in-memory, never
// printed) so the anchor flow needs no key juggling.
import { randomBytes } from 'node:crypto';
import { buildAuthMessage } from '../../agent-registry/src/auth.js';
import { buildApiKeyScope } from '../../agent-registry/src/api-keys.js';

export async function mintApiKey({ registryUrl, wallet, name = 'axp-anchor-key' }) {
  const owner = wallet.address;
  const payload = { name, owner };
  const scope = buildApiKeyScope(payload);
  const nonce = '0x' + randomBytes(16).toString('hex');
  const issued_at = new Date().toISOString();
  const message = buildAuthMessage({ action: 'api_keys.register', agentId: owner, address: owner, nonce, issuedAt: issued_at, scope });
  const signature = await wallet.signMessage(message);

  const res = await fetch(`${registryUrl.replace(/\/$/, '')}/api-keys/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, owner, auth: { agent_id: owner, address: owner, signature, nonce, issued_at } }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`api-key register failed: ${JSON.stringify(json)}`);
  }
  return { secret: json.secret, keyId: json.api_key?.key_id, owner };
}
