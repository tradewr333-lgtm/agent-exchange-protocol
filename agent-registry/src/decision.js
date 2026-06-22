// AXP Decision API — sell the DECISION, not just the data.
//
// Miner agents (hosted on AXP) submit price OBSERVATIONS for a symbol from named
// venues/sources. This module aggregates the fresh observations and computes a
// structured arbitrage signal: which venue is cheapest to buy, which is richest to
// sell, the net spread after fees, and a CONSENSUS CONFIDENCE.
//
// HONESTY (load-bearing — do not "improve" into marketing):
//   - confidence is derived from REAL corroboration: how many independent sources
//     agree, how fresh the quotes are, and a plausibility penalty for implausibly
//     large spreads (which on real exchanges almost always mean stale/illiquid data).
//     It is NOT "historical accuracy" and NOT the fabricated `70% + 0.03*(N/100)^2`.
//   - The output is an observed spread, not investment advice. Fees beyond a flat
//     per-side estimate, slippage, liquidity and withdrawal times are NOT modeled.
//
// Pure + network-free so it is unit-tested deterministically.

export const DECISION_VERSION = 1;

export function decisionPriceUsd(env = process.env) {
  const n = Number(env.AXP_DECISION_PRICE_USD);
  return Number.isFinite(n) && n > 0 ? n : 0.01; // default 1¢/decision
}

// Fraction of each paid decision shared with the miners that produced the data.
export function minerRewardShare(env = process.env) {
  const n = Number(env.AXP_DECISION_MINER_SHARE);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.2; // default 20%
}

// Treat stablecoins as one quote unit so BTC/USDC and BTC/USDT cross-validate.
const STABLE = new Set(['USD', 'USDC', 'USDT', 'DAI', 'BUSD', 'FDUSD', 'USDP', 'TUSD']);
export function normalizeSymbol(symbol) {
  const s = String(symbol || '').toUpperCase().trim();
  const parts = s.split(/[\/\-_:]/).filter(Boolean);
  if (parts.length === 2) {
    const [base, quote] = parts;
    return `${base}/${STABLE.has(quote) ? 'USD' : quote}`;
  }
  return s;
}

function median(nums) {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Pick, per source, the freshest observation for the target symbol.
function latestPerSource(observations, normSymbol, now, maxAgeMs) {
  const bySource = new Map();
  for (const o of observations) {
    if (!o || normalizeSymbol(o.symbol) !== normSymbol) continue;
    const ts = Number(o.ts || o.timestamp || 0);
    if (!ts || now - ts > maxAgeMs) continue; // stale
    const price = Number(o.price ?? o.mid ?? ((Number(o.bid) + Number(o.ask)) / 2));
    if (!Number.isFinite(price) || price <= 0) continue;
    const ask = Number.isFinite(Number(o.ask)) && Number(o.ask) > 0 ? Number(o.ask) : price;
    const bid = Number.isFinite(Number(o.bid)) && Number(o.bid) > 0 ? Number(o.bid) : price;
    const source = String(o.source || o.exchange || 'unknown').toLowerCase();
    const prev = bySource.get(source);
    if (!prev || ts > prev.ts) {
      bySource.set(source, { source, price, ask, bid, ts, agent_id: o.agent_id || null, owner: o.owner || null });
    }
  }
  return [...bySource.values()];
}

/**
 * Compute an arbitrage decision for a symbol from a set of observations.
 * @returns the structured decision object (always — action is HOLD when no edge).
 */
export function computeDecision({ symbol, observations = [], env = process.env, now = Date.now(), requestId } = {}) {
  const normSymbol = normalizeSymbol(symbol);
  const feePerSide = Number(env.AXP_DECISION_FEE_PCT_PER_SIDE);
  const feePctPerSide = Number.isFinite(feePerSide) && feePerSide >= 0 ? feePerSide : 0.1; // 0.1%/side
  const minProfit = Number(env.AXP_DECISION_MIN_PROFIT_PCT);
  const minProfitPct = Number.isFinite(minProfit) && minProfit > 0 ? minProfit : 0.2;
  const maxAgeMs = Number(env.AXP_DECISION_MAX_AGE_MS) > 0 ? Number(env.AXP_DECISION_MAX_AGE_MS) : 120_000;

  const id = requestId || `dec_${new Date(now).toISOString().slice(0, 10).replace(/-/g, '')}_${Math.random().toString(36).slice(2, 8)}`;
  const disclaimer = 'Observed cross-source spread, NOT investment advice. Spreads may be illiquid or stale; slippage, liquidity, withdrawal times and fees beyond a flat per-side estimate are not modeled. Confidence reflects data corroboration, not historical accuracy.';

  const quotes = latestPerSource(observations, normSymbol, now, maxAgeMs);
  const base = {
    request_id: id,
    asset: normSymbol,
    decision: { action: 'HOLD', confidence: 0, reasoning: '' },
    opportunity: null,
    context: { sources_count: quotes.length, observations_used: 0, fee_percent_per_side: feePctPerSide, max_age_ms: maxAgeMs },
    contributors: [],
    disclaimer,
  };

  if (quotes.length === 0) {
    base.decision.reasoning = `No fresh observations for ${normSymbol} within ${Math.round(maxAgeMs / 1000)}s. Need miners covering this symbol.`;
    return base;
  }

  const mids = quotes.map((q) => q.price);
  const consensus = median(mids);

  if (quotes.length === 1) {
    base.decision.reasoning = `Only one source (${quotes[0].source}) reporting ${normSymbol}; no cross-venue spread to arbitrage. Consensus price ${consensus}.`;
    base.context.observations_used = 1;
    base.context.consensus_price = consensus;
    base.contributors = quotes.filter((q) => q.agent_id).map((q) => ({ agent_id: q.agent_id, owner: q.owner }));
    return base;
  }

  // Cheapest place to BUY (lowest ask) vs richest place to SELL (highest bid).
  const buy = quotes.reduce((a, b) => (b.ask < a.ask ? b : a));
  const sell = quotes.reduce((a, b) => (b.bid > a.bid ? b : a));
  const grossPct = ((sell.bid - buy.ask) / buy.ask) * 100;
  const netPct = grossPct - 2 * feePctPerSide;

  // --- Consensus confidence (0..1), honest construction ---
  const sourceFactor = Math.min(quotes.length / 5, 1); // more corroborating venues → higher
  const ages = quotes.map((q) => (now - q.ts) / maxAgeMs);
  const freshnessFactor = Math.max(0, 1 - (ages.reduce((s, a) => s + a, 0) / ages.length));
  let confidence = sourceFactor * freshnessFactor;
  // Plausibility penalty: real liquid cross-exchange spreads rarely exceed ~2%.
  // A huge "spread" almost always means a stale/illiquid quote, so trust it LESS.
  if (netPct > 2) confidence *= Math.max(0.15, 2 / netPct);
  confidence = Math.max(0, Math.min(1, Number(confidence.toFixed(3))));

  const opportunity = (buy.source !== sell.source) ? {
    buy_from: { source: buy.source, price: Number(buy.ask) },
    sell_to: { source: sell.source, price: Number(sell.bid) },
    gross_profit_percent: Number(grossPct.toFixed(4)),
    net_profit_percent: Number(netPct.toFixed(4)),
    fee_percent_per_side: feePctPerSide,
    execution_window_seconds: Math.max(1, Math.round((maxAgeMs / 1000) * freshnessFactor)),
  } : null;

  const action = (opportunity && netPct >= minProfitPct) ? 'BUY_NOW' : 'HOLD';
  const reasoning = opportunity
    ? (action === 'BUY_NOW'
        ? `Buy on ${buy.source} @ ${buy.ask}, sell on ${sell.source} @ ${sell.bid}: net ${netPct.toFixed(2)}% after ${(2 * feePctPerSide).toFixed(2)}% fees, corroborated by ${quotes.length} sources.`
        : `Best spread ${normSymbol} is ${netPct.toFixed(2)}% net (${buy.source}→${sell.source}), below the ${minProfitPct}% threshold. Hold.`)
    : `All ${quotes.length} sources agree on ${normSymbol} (~${consensus}); no profitable spread.`;

  return {
    request_id: id,
    asset: normSymbol,
    decision: { action, confidence, reasoning },
    opportunity,
    context: {
      sources_count: quotes.length,
      observations_used: quotes.length,
      consensus_price: consensus,
      fee_percent_per_side: feePctPerSide,
      max_age_ms: maxAgeMs,
      sources: quotes.map((q) => q.source),
    },
    // Miners whose data formed this decision (for the reward split).
    contributors: dedupeContributors(action === 'BUY_NOW' ? [buy, sell] : quotes),
    disclaimer,
  };
}

function dedupeContributors(quotes) {
  const seen = new Map();
  for (const q of quotes) {
    if (q.agent_id && !seen.has(q.agent_id)) seen.set(q.agent_id, { agent_id: q.agent_id, owner: q.owner || null });
  }
  return [...seen.values()];
}

// --- Track record (honest, self-scoring) ---
// Map of normalized symbol → median mid price from fresh observations.
export function consensusBySymbol(observations = [], now = Date.now(), maxAgeMs = 5 * 60 * 1000) {
  const bySymbol = new Map();
  for (const o of observations) {
    if (!o || !o.symbol) continue;
    const ts = Number(o.ts || o.timestamp || 0);
    if (!ts || now - ts > maxAgeMs) continue;
    const price = Number(o.price ?? o.mid ?? ((Number(o.bid) + Number(o.ask)) / 2));
    if (!Number.isFinite(price) || price <= 0) continue;
    const sym = normalizeSymbol(o.symbol);
    if (!bySymbol.has(sym)) bySymbol.set(sym, []);
    bySymbol.get(sym).push(price);
  }
  const out = {};
  for (const [sym, prices] of bySymbol) out[sym] = median(prices);
  return out;
}

// Score predictions whose eval window has elapsed against the realized consensus.
// Mutates copies; returns { updated, scoredNow }. A "hit" = abs error within tolerance.
export function scorePredictions(predictions = [], consensusNow = {}, { now = Date.now(), evalWindowMs = 300_000, tolerancePct = 0.5 } = {}) {
  let scoredNow = 0;
  const updated = predictions.map((p) => {
    if (p.scored || now - Number(p.ts) < evalWindowMs) return p;
    const realized = consensusNow[p.symbol];
    if (!Number.isFinite(realized) || !Number.isFinite(Number(p.predicted_price)) || Number(p.predicted_price) <= 0) return p;
    const errorPct = Math.abs(realized - p.predicted_price) / p.predicted_price * 100;
    scoredNow += 1;
    return { ...p, scored: true, realized_price: realized, error_pct: Number(errorPct.toFixed(4)), hit: errorPct <= tolerancePct, scored_at: now };
  });
  return { updated, scoredNow };
}

// Aggregate accuracy over scored predictions.
export function trackRecordStats(predictions = []) {
  const scored = predictions.filter((p) => p.scored && Number.isFinite(Number(p.error_pct)));
  if (!scored.length) return { scored_count: 0, mean_abs_error_pct: null, hit_rate: null, by_symbol: {} };
  const meanErr = scored.reduce((s, p) => s + Number(p.error_pct), 0) / scored.length;
  const hits = scored.filter((p) => p.hit).length;
  const bySymbol = {};
  for (const p of scored) {
    const b = (bySymbol[p.symbol] ||= { n: 0, err: 0, hits: 0 });
    b.n += 1; b.err += Number(p.error_pct); b.hits += p.hit ? 1 : 0;
  }
  const by_symbol = {};
  for (const [sym, b] of Object.entries(bySymbol)) {
    by_symbol[sym] = { scored: b.n, mean_abs_error_pct: Number((b.err / b.n).toFixed(4)), hit_rate: Number((b.hits / b.n).toFixed(4)) };
  }
  return {
    scored_count: scored.length,
    mean_abs_error_pct: Number(meanErr.toFixed(4)),
    hit_rate: Number((hits / scored.length).toFixed(4)),
    by_symbol,
  };
}

// Build the coverage map from registered miner agents: which agent "owns" (and earns
// from) each symbol. First claim wins, so user miners extend NEW coverage rather than
// duplicating existing pairs. Returns { symbolOwner, bases }.
export function buildCoverage(minerAgents = []) {
  const symbolOwner = {};
  const bases = new Set();
  for (const m of minerAgents) {
    const syms = (m.miner_config && Array.isArray(m.miner_config.symbols)) ? m.miner_config.symbols : [];
    for (const s of syms) {
      const sym = normalizeSymbol(s);
      if (!sym.includes('/')) continue;
      if (!symbolOwner[sym]) {
        symbolOwner[sym] = { agent_id: m.agent_id, owner: m.owner || null };
        bases.add(sym.split('/')[0]);
      }
    }
  }
  return { symbolOwner, bases: [...bases] };
}

// Public "teaser" — action + confidence only, no executable prices. Free preview.
export function teaser(decision) {
  return {
    request_id: decision.request_id,
    asset: decision.asset,
    decision: { action: decision.decision.action, confidence: decision.decision.confidence },
    sources_count: decision.context.sources_count,
    paid_endpoint: 'POST /x402/decision/call',
    note: 'Full opportunity (venues, prices, net %) requires a paid x402 call.',
    disclaimer: decision.disclaimer,
  };
}
