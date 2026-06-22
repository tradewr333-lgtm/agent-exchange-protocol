// In-process auto-miner — makes the Decision API self-sustaining.
//
// The whole "miners feed data" loop has a cold-start problem: with zero observations,
// /decision can't sell anything. This runs ENTIRELY server-side on a timer (like the
// swarm heartbeat) and feeds REAL multi-venue prices from CoinGecko into the store,
// attributed to a system miner agent. So the Decision API always has fresh data 24/7
// without anyone running a script.
//
// Enable with AXP_DECISION_MINE_ENABLED=true. Coins via AXP_DECISION_COINS (CoinGecko
// ids). Rewards for the system miner accrue to AXP_DECISION_PAYTO / AXP_TREASURY_ADDRESS.
//
// HONEST: CoinGecko's converted_last.usd is a reference price, not an executable fill.
// The data is real and multi-venue, but the resulting "spread" is a monitoring signal,
// not a guaranteed-profit arbitrage instruction.
import { appendObservations, loadAgentsRegistry, saveAgentsRegistry } from './store.js';

const SYMBOL = { bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', binancecoin: 'BNB', ripple: 'XRP', cardano: 'ADA', dogecoin: 'DOGE', chainlink: 'LINK', avalanche: 'AVAX' };
export const SYSTEM_MINER_ID = 'system_decision_miner';

export function decisionMineEnabled(env = process.env) {
  return env.AXP_DECISION_MINE_ENABLED === 'true';
}

function minerOwner(env = process.env) {
  return env.AXP_DECISION_PAYTO || env.AXP_TREASURY_ADDRESS || null;
}

// Ensure a system miner agent exists so observations + rewards have an identity.
// origin 'system_miner' keeps it OUT of the x402 payable-agent discovery, but it still
// shows on /loop (which filters by `miner`) and can be credited in the reward split.
export async function ensureMinerAgent(env = process.env) {
  let registry;
  try { registry = await loadAgentsRegistry(); }
  catch { registry = { schema: 'axp.agents.v0', agents: [] }; }
  if (!Array.isArray(registry.agents)) registry.agents = [];
  const existing = registry.agents.find((a) => a.agent_id === SYSTEM_MINER_ID);
  const owner = minerOwner(env);
  if (existing) {
    if (owner && existing.owner !== owner) {
      const agents = registry.agents.map((a) => (a.agent_id === SYSTEM_MINER_ID ? { ...a, owner } : a));
      await saveAgentsRegistry({ ...registry, agents });
    }
    return existing;
  }
  const agent = {
    agent_id: SYSTEM_MINER_ID,
    name: 'AXP Auto-Miner',
    role: 'provider',
    status: 'active',
    services: ['price_feed'],
    skills: ['price_tracker'],
    reputation: 0,
    owner,
    origin: 'system_miner',
    miner: true,
    miner_config: { auto: true, registered_at: new Date().toISOString() },
    real_earnings_usd: 0,
    created_at: new Date().toISOString(),
  };
  await saveAgentsRegistry({ ...registry, agents: [...registry.agents, agent] });
  return agent;
}

// Fetch per-exchange tickers for one coin → observation rows (USD-quoted only).
export async function fetchCoinObservations(coinId, { maxVenues = 8, now = Date.now() } = {}) {
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/tickers?depth=false`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`coingecko ${coinId} HTTP ${res.status}`);
  const json = await res.json();
  const base = SYMBOL[coinId] || String(json?.tickers?.[0]?.base || coinId).toUpperCase();
  const seen = new Set();
  const obs = [];
  for (const t of (json.tickers || [])) {
    const target = String(t.target || '').toUpperCase();
    if (!['USD', 'USDT', 'USDC'].includes(target)) continue;
    const price = Number(t.converted_last?.usd ?? t.last);
    if (!Number.isFinite(price) || price <= 0) continue;
    const venue = String(t.market?.name || 'unknown');
    if (seen.has(venue)) continue;
    seen.add(venue);
    const spread = Number(t.bid_ask_spread_percentage) > 0 ? Number(t.bid_ask_spread_percentage) / 100 : 0.0005;
    obs.push({
      symbol: `${base}/USD`,
      source: venue,
      price,
      bid: Number((price * (1 - spread / 2)).toFixed(8)),
      ask: Number((price * (1 + spread / 2)).toFixed(8)),
      ts: now,
      agent_id: SYSTEM_MINER_ID,
      owner: minerOwner(),
    });
    if (obs.length >= maxVenues) break;
  }
  return obs;
}

export async function runDecisionMineOnce(env = process.env) {
  const coins = (env.AXP_DECISION_COINS || 'bitcoin,ethereum,solana').split(',').map((s) => s.trim()).filter(Boolean);
  await ensureMinerAgent(env);
  const now = Date.now();
  let all = [];
  for (const coin of coins) {
    try { all = all.concat(await fetchCoinObservations(coin, { now })); }
    catch (err) { console.warn('decision_mine_fetch', coin, err?.message || err); }
  }
  if (!all.length) return { ok: false, accepted: 0 };
  const accepted = await appendObservations(all);
  const symbols = [...new Set(all.map((o) => o.symbol))];
  console.log(`[auto-miner] ${accepted} obs across ${symbols.join(', ')} (${[...new Set(all.map((o) => o.source))].length} venues)`);
  return { ok: true, accepted, symbols };
}

let timer = null;
export function startDecisionMiner(env = process.env) {
  if (!decisionMineEnabled(env)) return null;
  if (!minerOwner(env)) { console.warn('[auto-miner] no owner wallet (set AXP_DECISION_PAYTO or AXP_TREASURY_ADDRESS); skipping'); return null; }
  const intervalMs = Math.max(60_000, Number(env.AXP_DECISION_MINE_INTERVAL_MS) || 180_000);
  console.log(`[auto-miner] enabled: every ${intervalMs / 1000}s`);
  runDecisionMineOnce(env).catch((e) => console.warn('[auto-miner] first run', e?.message || e));
  timer = setInterval(() => { runDecisionMineOnce(env).catch((e) => console.warn('[auto-miner]', e?.message || e)); }, intervalMs);
  if (timer.unref) timer.unref();
  return timer;
}
