import { createHash, randomUUID } from 'node:crypto';
import {
  getLatestTrustAnchor,
  listTrustAnchors as listStoredTrustAnchors,
  listTrustEventsAfterId,
  saveTrustAnchor,
} from './store.js';

const DEFAULT_REGISTRY_URL = 'https://registry.axp.network';

export async function prepareTrustAnchorBatch(options = {}) {
  const limit = normalizeLimit(options.limit, 100);
  const latestRecorded = await getLatestTrustAnchor({ status: 'recorded' });
  const afterEventId = Number(options.after_event_id ?? latestRecorded?.to_event_id ?? 0);
  const events = await listTrustEventsAfterId(afterEventId, limit);

  if (events.events.length === 0) {
    return {
      ok: false,
      status: 404,
      error: 'no_unanchored_trust_events',
      after_event_id: afterEventId,
      latest_recorded_anchor: latestRecorded,
    };
  }

  const eventHashes = events.events.map((event) => event.event_hash);
  const merkle = buildMerkleRoot(eventHashes);
  const first = events.events[0];
  const last = events.events[events.events.length - 1];
  const batch = {
    protocol: 'AXP',
    schema: 'axp.trust_anchor.v0',
    batch_id: `axp_anchor_${randomUUID()}`,
    status: 'prepared',
    merkle_root: merkle.root,
    hash_algorithm: 'sha256',
    leaf_count: merkle.leaf_count,
    event_count: events.events.length,
    from_event_id: Number(first.id),
    to_event_id: Number(last.id),
    from_event_hash: first.event_hash,
    to_event_hash: last.event_hash,
    registry_url: options.registry_url ?? DEFAULT_REGISTRY_URL,
    batch_uri: `${options.registry_url ?? DEFAULT_REGISTRY_URL}/anchors/latest`,
    chain_id: options.chain_id ? Number(options.chain_id) : 56,
    contract_address: options.contract_address ?? null,
    event_hashes: eventHashes,
    events: events.events.map((event) => ({
      id: Number(event.id),
      event_type: event.event_type,
      agent_id: event.agent_id,
      counterparty_id: event.counterparty_id,
      contract_id: event.contract_id,
      value_usd: event.value_usd,
      event_hash: event.event_hash,
      created_at: event.created_at,
    })),
    prepared_at: new Date().toISOString(),
    onchain_call: {
      contract: 'AXPTrustAnchor',
      method: 'recordAnchor',
      args: [
        merkle.root,
        Number(first.id),
        Number(last.id),
        events.events.length,
        options.registry_url ?? DEFAULT_REGISTRY_URL,
        `${options.registry_url ?? DEFAULT_REGISTRY_URL}/anchors/latest`,
      ],
    },
  };

  const stored = await saveTrustAnchor(batch);
  return {
    ok: true,
    status: 201,
    anchor: {
      ...batch,
      stored_anchor: stored,
    },
  };
}

export async function recordTrustAnchor(payload = {}) {
  if (!payload.batch_id) {
    return { ok: false, status: 400, error: 'batch_id_required' };
  }
  if (!payload.merkle_root) {
    return { ok: false, status: 400, error: 'merkle_root_required' };
  }
  if (!payload.tx_hash) {
    return { ok: false, status: 400, error: 'tx_hash_required' };
  }

  const anchor = await saveTrustAnchor({
    protocol: 'AXP',
    schema: 'axp.trust_anchor.v0',
    batch_id: payload.batch_id,
    status: 'recorded',
    merkle_root: payload.merkle_root,
    from_event_id: Number(payload.from_event_id),
    to_event_id: Number(payload.to_event_id),
    event_count: Number(payload.event_count),
    chain_id: payload.chain_id ? Number(payload.chain_id) : 56,
    contract_address: payload.contract_address ?? null,
    tx_hash: payload.tx_hash,
    block_number: payload.block_number ?? null,
    registry_url: payload.registry_url ?? DEFAULT_REGISTRY_URL,
    batch_uri: payload.batch_uri ?? `${payload.registry_url ?? DEFAULT_REGISTRY_URL}/anchors/latest`,
    recorded_at: new Date().toISOString(),
  });

  return {
    ok: true,
    status: 200,
    anchor,
  };
}

export async function listTrustAnchors(filters = {}) {
  return listStoredTrustAnchors(filters);
}

export async function getLatestAnchor() {
  return getLatestTrustAnchor() ?? {
    protocol: 'AXP',
    schema: 'axp.trust_anchor.v0',
    status: 'no_anchor_recorded',
  };
}

export function buildMerkleRoot(eventHashes) {
  if (!Array.isArray(eventHashes) || eventHashes.length === 0) {
    throw new Error('event hashes are required');
  }

  let level = eventHashes.map(toBytes32Hex);
  while (level.length > 1) {
    const next = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1] ?? left;
      next.push(hashPair(left, right));
    }
    level = next;
  }

  return {
    root: level[0],
    leaf_count: eventHashes.length,
  };
}

function hashPair(left, right) {
  const leftHex = left.replace(/^0x/, '');
  const rightHex = right.replace(/^0x/, '');
  return `0x${createHash('sha256').update(Buffer.from(`${leftHex}${rightHex}`, 'hex')).digest('hex')}`;
}

function toBytes32Hex(value) {
  const normalized = String(value ?? '').replace(/^axp_/, '').replace(/^0x/, '');
  if (/^[a-fA-F0-9]{64}$/.test(normalized)) {
    return `0x${normalized.toLowerCase()}`;
  }

  return `0x${createHash('sha256').update(String(value ?? '')).digest('hex')}`;
}

function normalizeLimit(value, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }

  return Math.min(Math.trunc(number), 500);
}
