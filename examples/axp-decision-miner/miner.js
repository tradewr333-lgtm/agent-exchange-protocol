#!/usr/bin/env node
// AXP Decision Miner — feeds REAL multi-venue prices into the AXP Decision API.
//
// It pulls per-exchange tickers from CoinGecko (free, no key) for a few coins. Because
// CoinGecko returns the SAME coin priced on many exchanges, you get genuine cross-venue
// quotes — which is exactly what /decision needs to compute a real spread. The miner
// submits these as observations stamped with your agent identity, so when a buyer pays
// for a decision your data helped form, your agent earns part of the reward.
//
// SETUP:
//   1) Launch an agent on AXP (any template) and note its agent_id.
//   2) Mint an AXP API key (POST /api-keys/register) for the SAME owner wallet.
//   3) Run with env vars below.
//
// RUN:
//   AXP_BASE_URL=https://axp.network \
//   AXP_API_KEY=axp_live_xxx \
//   AXP_AGENT_ID=agent_data_processing_xxx \
//   COINS=bitcoin,ethereum,solana \
//   node miner.js
//
// It registers the agent as a miner, then submits fresh observations every INTERVAL_MS.

const BASE = (process.env.AXP_BASE_URL || 'https://axp.network').replace(/\/$/, '');
const API_KEY = process.env.AXP_API_KEY;
const AGENT_ID = process.env.AXP_AGENT_ID;
const COINS = (process.env.COINS || 'bitcoin,ethereum,solana').split(',').map((s) => s.trim()).filter(Boolean);
const INTERVAL_MS = Number(process.env.INTERVAL_MS || 45_000);
const MAX_VENUES = Number(process.env.MAX_VENUES_PER_COIN || 8);

// CoinGecko coin id → display base symbol.
const SYMBOL = { bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', binancecoin: 'BNB', ripple: 'XRP', cardano: 'ADA', dogecoin: 'DOGE' };

if (!API_KEY || !AGENT_ID) {
  console.error('Missing env. Required: AXP_API_KEY, AXP_AGENT_ID (and optionally AXP_BASE_URL, COINS).');
  process.exit(1);
}

async function axp(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-axp-api-key': API_KEY },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// Pull per-exchange tickers for one coin and turn them into observations.
async function observationsForCoin(coinId) {
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/tickers?include_exchange_logo=false&depth=false`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) { console.warn(`coingecko ${coinId} → HTTP ${res.status}`); return []; }
  const json = await res.json();
  const base = SYMBOL[coinId] || (json?.tickers?.[0]?.base ?? coinId).toUpperCase();
  const now = Date.now();
  const seen = new Set();
  const obs = [];
  for (const t of (json.tickers || [])) {
    // USD-quoted pairs only (USD/USDT/USDC) so they cross-validate as one unit.
    const target = String(t.target || '').toUpperCase();
    if (!['USD', 'USDT', 'USDC'].includes(target)) continue;
    const price = Number(t.converted_last?.usd ?? t.last);
    if (!Number.isFinite(price) || price <= 0) continue;
    const venue = String(t.market?.name || 'unknown');
    if (seen.has(venue)) continue; // one quote per venue
    seen.add(venue);
    // CoinGecko gives bid/ask spread % sometimes; approximate bid/ask from last if absent.
    const spread = Number(t.bid_ask_spread_percentage) > 0 ? Number(t.bid_ask_spread_percentage) / 100 : 0.0005;
    obs.push({
      symbol: `${base}/USD`,
      source: venue,
      price,
      bid: Number((price * (1 - spread / 2)).toFixed(8)),
      ask: Number((price * (1 + spread / 2)).toFixed(8)),
      ts: now,
    });
    if (obs.length >= MAX_VENUES) break;
  }
  return obs;
}

async function cycle() {
  let all = [];
  for (const coin of COINS) {
    try { all = all.concat(await observationsForCoin(coin)); }
    catch (e) { console.warn(`fetch ${coin} failed:`, e?.message || e); }
  }
  if (!all.length) { console.log('no observations this cycle'); return; }
  const r = await axp('/miners/observations', { agent_id: AGENT_ID, observations: all });
  const symbols = [...new Set(all.map((o) => o.symbol))];
  console.log(`[${new Date().toLocaleTimeString()}] submitted ${all.length} obs across ${symbols.join(', ')} → ${r.status} ${JSON.stringify(r.data)}`);
}

(async () => {
  const reg = await axp('/miners/register', { agent_id: AGENT_ID, symbols: COINS.map((c) => `${SYMBOL[c] || c}/USD`) });
  console.log(`register → ${reg.status} ${JSON.stringify(reg.data)}`);
  if (reg.status >= 400) process.exit(1);
  await cycle();
  setInterval(cycle, INTERVAL_MS);
  console.log(`mining every ${INTERVAL_MS / 1000}s — Ctrl+C to stop`);
})();
