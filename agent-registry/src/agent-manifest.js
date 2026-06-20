export const AGENT_MANIFEST_SCHEMA = 'axp.agent_manifest.v0';

const defaultTimeoutMs = 8_000;

export async function verifyAgentManifest(input = {}) {
  const manifestUrl = resolveManifestUrl(input);
  if (!manifestUrl.ok) {
    return manifestUrl;
  }

  const fetched = await fetchJson(manifestUrl.url);
  if (!fetched.ok) {
    return fetched;
  }

  const validation = validateAgentManifest(fetched.json, {
    expectedAgentId: input.agent_id,
    manifestUrl: manifestUrl.url,
  });

  return {
    protocol: 'AXP',
    version: '0.1.0',
    schema: 'axp.agent_manifest_verification.v0',
    status: validation.valid ? 'verified' : 'invalid',
    discoverable: validation.valid,
    manifest_url: manifestUrl.url,
    agent_id: validation.agent_id ?? null,
    axp_trust: validation.axp_trust ?? null,
    errors: validation.errors,
    warnings: validation.warnings,
    manifest: fetched.json,
  };
}

export function validateAgentManifest(manifest, options = {}) {
  const errors = [];
  const warnings = [];

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return {
      valid: false,
      agent_id: null,
      axp_trust: null,
      errors: ['manifest_must_be_json_object'],
      warnings,
    };
  }

  const agentId = stringValue(manifest.agent_id);
  const services = Array.isArray(manifest.services) ? manifest.services.filter((item) => typeof item === 'string') : [];
  const trust = manifest.trust && typeof manifest.trust === 'object' ? manifest.trust : null;
  const provider = stringValue(trust?.provider);
  const scoreUrl = stringValue(trust?.score_url);
  const riskUrl = stringValue(trust?.risk_url);
  const registryUrl = stringValue(trust?.registry_url);

  if (manifest.schema !== AGENT_MANIFEST_SCHEMA) {
    errors.push('schema_must_be_axp_agent_manifest_v0');
  }

  if (!agentId) {
    errors.push('agent_id_required');
  }

  if (options.expectedAgentId && agentId && options.expectedAgentId !== agentId) {
    errors.push('agent_id_mismatch');
  }

  if (!stringValue(manifest.name)) {
    errors.push('name_required');
  }

  if (!stringValue(manifest.operator)) {
    errors.push('operator_required');
  }

  if (services.length === 0) {
    errors.push('services_required');
  }

  if (!trust) {
    errors.push('trust_block_required');
  } else {
    if (provider !== 'AXP') {
      errors.push('trust_provider_must_be_AXP');
    }

    if (!scoreUrl) {
      errors.push('trust_score_url_required');
    }

    if (!riskUrl) {
      errors.push('risk_url_required');
    }

    if (!registryUrl) {
      warnings.push('registry_url_recommended');
    }
  }

  for (const [field, value] of [
    ['manifest_url', options.manifestUrl],
    ['score_url', scoreUrl],
    ['risk_url', riskUrl],
    ['registry_url', registryUrl],
  ]) {
    if (value && !isHttpsUrl(value)) {
      errors.push(`${field}_must_be_https_url`);
    }
  }

  if (!manifest.endpoints || typeof manifest.endpoints !== 'object') {
    warnings.push('endpoints_block_recommended');
  }

  return {
    valid: errors.length === 0,
    agent_id: agentId || null,
    axp_trust: trust
      ? {
          provider,
          registry_url: registryUrl || null,
          score_url: scoreUrl || null,
          risk_url: riskUrl || null,
        }
      : null,
    errors,
    warnings,
  };
}

function resolveManifestUrl(input) {
  const manifestUrl = stringValue(input.manifest_url ?? input.url);
  const domain = stringValue(input.domain);

  if (manifestUrl) {
    if (!isHttpsUrl(manifestUrl)) {
      return { ok: false, status: 400, error: 'manifest_url_must_be_https_url' };
    }
    return { ok: true, url: manifestUrl };
  }

  if (domain) {
    const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!cleanDomain || cleanDomain.includes('..') || cleanDomain.includes(' ')) {
      return { ok: false, status: 400, error: 'invalid_domain' };
    }
    return { ok: true, url: `https://${cleanDomain}/.well-known/agent.json` };
  }

  return { ok: false, status: 400, error: 'manifest_url_or_domain_required' };
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), defaultTimeoutMs);

  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        ok: false,
        status: 400,
        error: 'manifest_fetch_failed',
        manifest_url: url,
        http_status: response.status,
      };
    }

    return { ok: true, json: await response.json() };
  } catch (error) {
    return {
      ok: false,
      status: 400,
      error: 'manifest_fetch_failed',
      manifest_url: url,
      message: error?.name === 'AbortError' ? 'request_timeout' : 'request_failed',
    };
  } finally {
    clearTimeout(timeout);
  }
}

function stringValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}
