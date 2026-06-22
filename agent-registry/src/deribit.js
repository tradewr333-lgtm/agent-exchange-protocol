// Deribit PUBLIC market data → live Iron Condor signal. No API key, no execution.
//
// Uses only public endpoints (index price, instruments, ticker greeks/quotes), so we
// never touch the user's account. Result is cached briefly to avoid hammering Deribit.
import { buildIronCondor } from './iron-condor.js';

const BASE = 'https://www.deribit.com/api/v2';
const cache = new Map(); // asset -> { at, data }
const CACHE_MS = 60_000;

async function dfetch(path, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(`${BASE}${path}`, { headers: { accept: 'application/json' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    if (j.error) throw new Error(j.error.message || 'deribit_error');
    return j.result;
  } finally { clearTimeout(t); }
}

async function getSpot(asset) {
  const r = await dfetch(`/public/get_index_price?index_name=${asset.toLowerCase()}_usd`);
  return Number(r?.index_price);
}

// Nearest non-expired option expiry (timestamp + Deribit code like 28JUN26).
async function getNearestExpiry(asset) {
  const insts = await dfetch(`/public/get_instruments?currency=${asset}&kind=option&expired=false`);
  if (!Array.isArray(insts) || !insts.length) return null;
  const now = Date.now();
  let best = null;
  for (const i of insts) {
    const ts = Number(i.expiration_timestamp);
    if (ts > now && (!best || ts < best.ts)) best = { ts, code: i.instrument_name.split('-')[1] };
  }
  return best;
}

async function mapWithConcurrency(items, limit, fn) {
  const out = []; let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]).catch(() => null); }
  });
  await Promise.all(workers);
  return out;
}

// Fetch per-instrument greeks + quotes for strikes within a band around spot.
async function getChain(asset, expiryCode, spot) {
  const insts = await dfetch(`/public/get_instruments?currency=${asset}&kind=option&expired=false`);
  const lo = spot * 0.6; const hi = spot * 1.4;
  const wanted = insts.filter((i) => {
    const p = i.instrument_name.split('-');
    return p[1] === expiryCode && Number(i.strike) >= lo && Number(i.strike) <= hi;
  });
  const tickers = await mapWithConcurrency(wanted, 6, async (i) => {
    const t = await dfetch(`/public/ticker?instrument_name=${i.instrument_name}`);
    return {
      instrument: i.instrument_name,
      strike: Number(i.strike),
      type: i.option_type === 'call' ? 'C' : 'P',
      delta: Number(t?.greeks?.delta),
      bid: Number(t?.best_bid_price),
      ask: Number(t?.best_ask_price),
    };
  });
  return tickers.filter((x) => x && Number.isFinite(x.delta) && Number.isFinite(x.bid));
}

function baseFor(testnet) { return testnet ? 'https://test.deribit.com/api/v2' : BASE; }

// Authenticate with the user's API key and read account summary (READ-only call).
// Confirms the key works + shows balance, like a "test connection". No trade here.
export async function testConnection({ apiKey, secret, testnet = true } = {}) {
  if (!apiKey || !secret) return { ok: false, error: 'missing_credentials' };
  const base = baseFor(testnet);
  try {
    const authRes = await fetch(`${base}/public/auth?grant_type=client_credentials&client_id=${encodeURIComponent(apiKey)}&client_secret=${encodeURIComponent(secret)}`, { headers: { accept: 'application/json' } });
    const authJ = await authRes.json();
    if (authJ.error) return { ok: false, error: authJ.error.message || 'auth_failed' };
    const token = authJ.result?.access_token;
    if (!token) return { ok: false, error: 'no_token' };
    const accRes = await fetch(`${base}/private/get_account_summary?currency=BTC&extended=false`, { headers: { accept: 'application/json', authorization: `Bearer ${token}` } });
    const accJ = await accRes.json();
    if (accJ.error) return { ok: false, error: accJ.error.message || 'account_summary_failed' };
    const r = accJ.result || {};
    return { ok: true, testnet, currency: 'BTC', equity: Number(r.equity), balance: Number(r.balance), available_funds: Number(r.available_funds) };
  } catch (err) {
    return { ok: false, error: 'deribit_unreachable', detail: String(err?.message || err) };
  }
}

export async function ironCondorSignal(asset = 'BTC', { putDelta = -0.12, callDelta = 0.12, wingStrikes = 1 } = {}) {
  const A = String(asset).toUpperCase();
  const hit = cache.get(A);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  try {
    const spot = await getSpot(A);
    if (!Number.isFinite(spot)) return { ok: false, error: 'deribit_spot_unavailable' };
    const exp = await getNearestExpiry(A);
    if (!exp) return { ok: false, error: 'no_expiry' };
    const chain = await getChain(A, exp.code, spot);
    const signal = buildIronCondor(chain, { spot, putDelta, callDelta, wingStrikes, asset: A, expiry: exp.code });
    const data = { ...signal, generated_at: new Date().toISOString(), source: 'deribit_public' };
    cache.set(A, { at: Date.now(), data });
    return data;
  } catch (err) {
    return { ok: false, error: 'deribit_unreachable', detail: String(err?.message || err) };
  }
}
