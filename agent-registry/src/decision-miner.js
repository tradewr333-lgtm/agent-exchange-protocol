// In-process auto-miner — makes the Decision API self-sustaining + builds a track record.
//
// Pulls REAL top-of-book bid/ask from multiple public exchange APIs (no key, no rate-limit
// pain) and feeds them into the store as observations, attributed to a system miner agent.
// Then it self-scores: each cycle it records the consensus price it computed and, a window
// later, compares it to the realized consensus — producing an honest, continuously growing
// accuracy record WITHOUT needing any external buyer.
//
// Enable with AXP_DECISION_MINE_ENABLED=true. Bases via AXP_DECISION_BASES (e.g. BTC,ETH,SOL).
// Rewards/identity owner via AXP_DECISION_PAYTO / AXP_TREASURY_ADDRESS.
//
// HONEST: top-of-book bid/ask is close to executable but still ignores size/liquidity,
// withdrawal time and venue fees. This is a consensus + monitoring signal, not a guarantee.
import { appendObservations, loadAgentsRegistry, saveAgentsRegistry, loadPredictions, savePredictions, loadRecentObservations, updateAgentFields } from './store.js';
import { normalizeSymbol, computeDecision, consensusBySymbol, scorePredictions, buildCoverage } from './decision.js';

function defaultBases(env = process.env) {
  return (env.AXP_DECISION_BASES || env.AXP_DECISION_COINS || 'BTC,ETH,SOL')
    .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
    .map((s) => ({ BITCOIN: 'BTC', ETHEREUM: 'ETH', SOLANA: 'SOL' }[s] || s));
}

export const SYSTEM_MINER_ID = 'system_decision_miner';

export function decisionMineEnabled(env = process.env) {
  return env.AXP_DECISION_MINE_ENABLED === 'true';
}
function minerOwner(env = process.env) {
  return env.AXP_DECISION_PAYTO || env.AXP_TREASURY_ADDRESS || null;
}

// Kraken uses XBT for BTC and odd result keys; take the first result entry.
function krakenPair(base) { return `${base === 'BTC' ? 'XBT' : base}USD`; }

// Public, key-free, globally-accessible exchange tickers. Each returns {bid, ask}.
const EXCHANGES = [
  { name: 'Coinbase', url: (b) => `https://api.exchange.coinbase.com/products/${b}-USD/ticker`, parse: (j) => ({ bid: +j.bid, ask: +j.ask }) },
  { name: 'Kraken', url: (b) => `https://api.kraken.com/0/public/Ticker?pair=${krakenPair(b)}`, parse: (j) => { const r = j.result?.[Object.keys(j.result)[0]]; return { bid: +r.b[0], ask: +r.a[0] }; } },
  { name: 'Bitstamp', url: (b) => `https://www.bitstamp.net/api/v2/ticker/${b.toLowerCase()}usd/`, parse: (j) => ({ bid: +j.bid, ask: +j.ask }) },
  { name: 'Bitfinex', url: (b) => `https://api-pub.bitfinex.com/v2/ticker/t${b}USD`, parse: (a) => ({ bid: +a[0], ask: +a[2] }) },
  { name: 'OKX', url: (b) => `https://www.okx.com/api/v5/market/ticker?instId=${b}-USDT`, parse: (j) => ({ bid: +j.data[0].bidPx, ask: +j.data[0].askPx }) },
];

async function fetchJson(url, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'axp-decision-miner/1.0' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

// Fetch one base across every exchange; tolerate per-venue failures.
// Returns raw quotes (no miner attribution — the caller stamps the owning agent).
export async function fetchBaseObservations(base, { now = Date.now() } = {}) {
  const results = await Promise.allSettled(EXCHANGES.map(async (ex) => {
    const j = await fetchJson(ex.url(base));
    const { bid, ask } = ex.parse(j);
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) throw new Error('bad quote');
    return { symbol: `${base}/USD`, source: ex.name, bid, ask, price: (bid + ask) / 2, ts: now };
  }));
  return results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
}

export async function ensureMinerAgent(env = process.env) {
  let registry;
  try { registry = await loadAgentsRegistry(); }
  catch { registry = { schema: 'axp.agents.v0', agents: [] }; }
  if (!Array.isArray(registry.agents)) registry.agents = [];
  const owner = minerOwner(env);
  const existing = registry.agents.find((a) => a.agent_id === SYSTEM_MINER_ID);
  if (existing) {
    // Backfill: keep owner current AND ensure the system miner always claims the
    // default bases, so user-deployed pairs EXTEND coverage instead of replacing it.
    const wantSymbols = defaultBases(env).map((b) => `${b}/USD`);
    const haveSymbols = (existing.miner_config && Array.isArray(existing.miner_config.symbols)) ? existing.miner_config.symbols : [];
    const needsSymbols = haveSymbols.length === 0;
    const needsOwner = owner && existing.owner !== owner;
    if (needsSymbols || needsOwner) {
      const agents = registry.agents.map((a) => (a.agent_id === SYSTEM_MINER_ID
        ? { ...a, owner: needsOwner ? owner : a.owner, miner_config: { ...(a.miner_config || {}), symbols: needsSymbols ? wantSymbols : haveSymbols } }
        : a));
      await saveAgentsRegistry({ ...registry, agents });
    }
    return existing;
  }
  const agent = {
    agent_id: SYSTEM_MINER_ID, name: 'AXP Auto-Miner', role: 'provider', status: 'active',
    services: ['price_feed'], skills: ['price_tracker'], reputation: 0, owner,
    origin: 'system_miner', miner: true,
    miner_config: { auto: true, symbols: defaultBases(env).map((b) => `${b}/USD`), registered_at: new Date().toISOString() },
    real_earnings_usd: 0, created_at: new Date().toISOString(),
  };
  await saveAgentsRegistry({ ...registry, agents: [...registry.agents, agent] });
  return agent;
}

// Self-scoring track record: score old predictions vs the realized consensus, then
// snapshot the current consensus as new predictions to be scored next time.
const EVAL_WINDOW_MS = () => Math.max(60_000, Number(process.env.AXP_DECISION_EVAL_WINDOW_MS) || 300_000);
const TOLERANCE_PCT = () => Number(process.env.AXP_DECISION_TOLERANCE_PCT) || 0.5;

export async function scoreAndSnapshot({ now = Date.now() } = {}) {
  const obs = await loadRecentObservations({ maxAgeMs: 5 * 60 * 1000, now });
  const consensus = consensusBySymbol(obs, now);
  let preds = await loadPredictions();
  const { updated, scoredNow } = scorePredictions(preds, consensus, { now, evalWindowMs: EVAL_WINDOW_MS(), tolerancePct: TOLERANCE_PCT() });
  preds = updated;
  for (const [symbol, price] of Object.entries(consensus)) {
    const d = computeDecision({ symbol, observations: obs, now });
    preds.push({ symbol, predicted_price: price, action: d.decision.action, confidence: d.decision.confidence, sources: d.context.sources_count, ts: now, scored: false });
  }
  await savePredictions(preds.slice(-5000));
  return { scoredNow, snapshotted: Object.keys(consensus).length };
}

export async function runDecisionMineOnce(env = process.env) {
  await ensureMinerAgent(env);
  // Coverage = every registered miner agent's claimed symbols (first claim wins).
  let registry;
  try { registry = await loadAgentsRegistry(); } catch { registry = { agents: [] }; }
  const miners = (registry.agents || []).filter((a) => a.miner);
  const { symbolOwner, bases } = buildCoverage(miners);
  const baseList = bases.length ? bases : defaultBases(env);
  const now = Date.now();

  let all = [];
  for (const base of baseList) {
    try {
      const quotes = await fetchBaseObservations(base, { now });
      for (const q of quotes) {
        const owner = symbolOwner[normalizeSymbol(q.symbol)] || { agent_id: SYSTEM_MINER_ID, owner: minerOwner(env) };
        all.push({ ...q, agent_id: owner.agent_id, owner: owner.owner });
      }
    } catch (err) { console.warn('decision_mine_fetch', base, err?.message || err); }
  }
  if (!all.length) { console.warn('[auto-miner] no venues reachable this cycle'); return { ok: false, accepted: 0 }; }
  const accepted = await appendObservations(all);
  const venues = [...new Set(all.map((o) => o.source))];

  // Update last_mine per contributing miner agent.
  const byAgent = {};
  for (const o of all) { (byAgent[o.agent_id] ||= { count: 0, symbols: new Set(), venues: new Set() }); byAgent[o.agent_id].count++; byAgent[o.agent_id].symbols.add(o.symbol); byAgent[o.agent_id].venues.add(o.source); }
  for (const [agentId, s] of Object.entries(byAgent)) {
    try { await updateAgentFields(agentId, { last_mine: { at: new Date(now).toISOString(), count: s.count, symbols: [...s.symbols], venues: [...s.venues] } }); } catch { /* best-effort */ }
  }
  const score = await scoreAndSnapshot({ now });
  console.log(`[auto-miner] ${accepted} obs · ${venues.length} venues · ${baseList.length} bases · ${miners.length} miners · scored ${score.scoredNow}`);
  return { ok: true, accepted, venues, bases: baseList, miners: miners.length, ...score };
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
