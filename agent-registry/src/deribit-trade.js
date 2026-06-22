// Deribit TRADE manager — authed execution primitives for the Iron Condor bot.
// ESM adaptation of the battle-tested DegenScan tm-bitget pattern, but for Deribit
// options. Verified against docs: /public/auth (client_credentials), /private/buy|sell
// (options amount in BTC; post_only defaults TRUE so we force it false to get fills),
// /private/get_positions, /private/get_open_orders_by_currency, /private/cancel_all_by_currency.
//
// Keys are TRADE-ONLY (no withdrawal). Nothing here can move funds off the exchange.

const tokenCache = new Map(); // key: apiKey|testnet -> { token, exp }

function base(testnet) { return testnet ? 'https://test.deribit.com/api/v2' : 'https://www.deribit.com/api/v2'; }

async function getJson(url, headers = {}, ms = 9000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal: ctrl.signal });
    const j = await res.json().catch(() => ({}));
    if (j.error) return { ok: false, error: j.error.message || j.error.code || 'deribit_error', raw: j.error };
    return { ok: true, result: j.result };
  } catch (err) {
    return { ok: false, error: 'unreachable', detail: String(err?.message || err) };
  } finally { clearTimeout(t); }
}

// OAuth token via client_credentials, cached until ~60s before expiry.
async function token(creds) {
  const k = `${creds.apiKey}|${creds.testnet ? 't' : 'm'}`;
  const hit = tokenCache.get(k);
  if (hit && Date.now() < hit.exp) return hit.token;
  const url = `${base(creds.testnet)}/public/auth?grant_type=client_credentials&client_id=${encodeURIComponent(creds.apiKey)}&client_secret=${encodeURIComponent(creds.secret)}`;
  const r = await getJson(url);
  if (!r.ok || !r.result?.access_token) return null;
  tokenCache.set(k, { token: r.result.access_token, exp: Date.now() + (Number(r.result.expires_in || 600) - 60) * 1000 });
  return r.result.access_token;
}

async function priv(creds, method, params = {}) {
  const tok = await token(creds);
  if (!tok) return { ok: false, error: 'auth_failed' };
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])).toString();
  return getJson(`${base(creds.testnet)}${method}?${qs}`, { authorization: `Bearer ${tok}` });
}

// Place an order. direction 'buy'|'sell'. amount in BTC (options). Defaults to a
// taker-friendly limit (post_only false) so the leg actually fills.
export async function placeOrder(creds, { instrument, direction, amount, type = 'limit', price = null, label = null, postOnly = false, timeInForce = 'good_til_cancelled', reduceOnly = false } = {}) {
  const method = direction === 'sell' ? '/private/sell' : '/private/buy';
  const params = { instrument_name: instrument, amount, type, post_only: postOnly, time_in_force: timeInForce };
  if (type === 'limit' && price != null) params.price = price;
  if (reduceOnly) params.reduce_only = true;
  if (label) params.label = label.slice(0, 64);
  const r = await priv(creds, method, params);
  if (!r.ok) return { ok: false, error: r.error, detail: r.detail };
  const o = r.result?.order || {};
  return { ok: true, order_id: o.order_id, state: o.order_state, filled: Number(o.filled_amount || 0), avg_price: Number(o.average_price || 0), trades: r.result?.trades || [] };
}

export async function getPositions(creds, { currency = 'BTC', kind = 'option' } = {}) {
  const r = await priv(creds, '/private/get_positions', { currency, kind });
  if (!r.ok) return { ok: false, error: r.error, positions: [] };
  const positions = (r.result || []).filter((p) => Number(p.size || 0) !== 0).map((p) => ({
    instrument: p.instrument_name, size: Number(p.size), direction: p.direction,
    avg_price: Number(p.average_price), mark_price: Number(p.mark_price),
    floating_pl: Number(p.floating_profit_loss), delta: Number(p.delta),
  }));
  return { ok: true, positions };
}

export async function getOpenOrders(creds, { currency = 'BTC', kind = 'option' } = {}) {
  const r = await priv(creds, '/private/get_open_orders_by_currency', { currency, kind });
  if (!r.ok) return { ok: false, error: r.error, orders: [] };
  return { ok: true, orders: (r.result || []).map((o) => ({ order_id: o.order_id, instrument: o.instrument_name, direction: o.direction, price: o.price, amount: o.amount, state: o.order_state })) };
}

export async function cancelAll(creds, { currency = 'BTC', kind = 'option' } = {}) {
  const r = await priv(creds, '/private/cancel_all_by_currency', { currency, kind, type: 'all' });
  return { ok: r.ok, cancelled: r.result, error: r.error };
}

// Public ticker (mark price + greeks) for an instrument — used to price legs / value the position.
export async function instrumentTicker(creds, instrument) {
  const r = await getJson(`${base(creds.testnet)}/public/ticker?instrument_name=${encodeURIComponent(instrument)}`);
  if (!r.ok) return { ok: false, error: r.error };
  const t = r.result || {};
  return { ok: true, mark_price: Number(t.mark_price), best_bid: Number(t.best_bid_price), best_ask: Number(t.best_ask_price), delta: Number(t.greeks?.delta), iv: Number(t.mark_iv) };
}
