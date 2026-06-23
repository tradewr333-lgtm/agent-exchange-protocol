// Iron Condor (delta 10-15) signal builder for BTC/ETH options on Deribit.
//
// This is a DECISION/SIGNAL only — it computes the 4-leg structure from REAL public
// option data (strikes, deltas, bid/ask) and reports credit, max risk, breakevens and
// an APPROXIMATE probability. It never executes, never holds keys, never promises
// returns. The user (or their agent) executes on their own Deribit account.
//
// Deribit options are priced in the underlying (BTC), strikes in USD. We convert the
// premium to USD with the spot so credit/risk/breakevens are all in USD.
//
// Pure + deterministic → unit-tested without network.

function nearestByDelta(options, target) {
  let best = null; let bestDiff = Infinity;
  for (const o of options) {
    const d = Math.abs(Number(o.delta) - target);
    if (d < bestDiff) { bestDiff = d; best = o; }
  }
  return best;
}

// `n` strikes further OTM from the short strike. Puts: lower strike. Calls: higher strike.
function furtherOTM(sortedAsc, shortStrike, side, n) {
  const idx = sortedAsc.findIndex((o) => o.strike === shortStrike);
  if (idx < 0) return null;
  const target = side === 'put' ? idx - n : idx + n;
  return sortedAsc[target] || null;
}

// Like furtherOTM, but starting `n` strikes out keep walking outward until we hit a
// strike with a usable ask (the wing is a BUY). Falls back to the n-th strike.
function furtherOTMPriceable(sortedAsc, shortStrike, side, n) {
  const idx = sortedAsc.findIndex((o) => o.strike === shortStrike);
  if (idx < 0) return null;
  const step = side === 'put' ? -1 : 1;
  for (let j = n; j < sortedAsc.length; j++) {
    const o = sortedAsc[idx + step * j];
    if (o && Number(o.ask) > 0) return o;
  }
  return sortedAsc[idx + step * n] || null;
}

/**
 * Build an Iron Condor from an option chain.
 * @param chain array of { strike, type:'C'|'P', delta, bid, ask } — premiums in BTC.
 * @param opts  { spot, putDelta=-0.12, callDelta=0.12, wingStrikes=1, expiry, asset }
 * @returns structured signal (USD-denominated) or { ok:false, error }.
 */
export function buildIronCondor(chain = [], opts = {}) {
  const { spot, putDelta = -0.12, callDelta = 0.12, wingStrikes = 1, expiry = null, asset = 'BTC' } = opts;
  if (!Number.isFinite(spot) || spot <= 0) return { ok: false, error: 'spot_required' };
  // Keep the FULL strike ladder (only require a delta) so protective wings — which sit
  // deep OTM and often have no bid, only an ask — are still available to buy.
  const puts = chain.filter((o) => o.type === 'P' && Number.isFinite(o.delta)).sort((a, b) => a.strike - b.strike);
  const calls = chain.filter((o) => o.type === 'C' && Number.isFinite(o.delta)).sort((a, b) => a.strike - b.strike);
  if (puts.length < wingStrikes + 1 || calls.length < wingStrikes + 1) return { ok: false, error: 'insufficient_chain' };

  // Shorts (we SELL) must have a real bid; restrict the delta search to those.
  const sellablePuts = puts.filter((o) => Number(o.bid) > 0);
  const sellableCalls = calls.filter((o) => Number(o.bid) > 0);
  const shortPut = nearestByDelta(sellablePuts.length ? sellablePuts : puts, putDelta);
  const shortCall = nearestByDelta(sellableCalls.length ? sellableCalls : calls, callDelta);
  if (!shortPut || !shortCall) return { ok: false, error: 'no_short_legs' };
  // Wings (we BUY) need an ask. Walk further OTM until we find a priceable strike.
  const longPut = furtherOTMPriceable(puts, shortPut.strike, 'put', wingStrikes);
  const longCall = furtherOTMPriceable(calls, shortCall.strike, 'call', wingStrikes);
  if (!longPut || !longCall) return { ok: false, error: 'no_protective_wings' };

  // Credit (BTC): receive bids on shorts, pay asks on longs. Convert to USD via spot.
  const creditBtc = (Number(shortPut.bid) + Number(shortCall.bid)) - (Number(longPut.ask) + Number(longCall.ask));
  const creditUsd = creditBtc * spot;
  const putWidth = shortPut.strike - longPut.strike;
  const callWidth = longCall.strike - shortCall.strike;
  const maxLossUsd = Math.max(putWidth, callWidth) - creditUsd; // per 1 BTC contract
  const lowerBreakeven = shortPut.strike - creditUsd;
  const upperBreakeven = shortCall.strike + creditUsd;
  // Approx probability price expires BETWEEN the shorts (both OTM). Delta ≈ P(ITM).
  const probInRange = Math.max(0, Math.min(1, 1 - Math.abs(Number(shortPut.delta)) - Number(shortCall.delta)));
  const riskReward = maxLossUsd > 0 ? creditUsd / maxLossUsd : null;

  const action = creditUsd > 0 && maxLossUsd > 0 ? 'OPEN' : 'SKIP';
  const reasoning = action === 'OPEN'
    ? `Sell ${shortPut.strike}P / ${shortCall.strike}C (delta ~${Math.abs(shortPut.delta).toFixed(2)}/${shortCall.delta.toFixed(2)}), buy ${longPut.strike}P / ${longCall.strike}C wings. Net credit $${creditUsd.toFixed(0)}, max loss $${maxLossUsd.toFixed(0)}, profit if ${asset} stays between $${lowerBreakeven.toFixed(0)}–$${upperBreakeven.toFixed(0)} at expiry.`
    : `No positive-credit / defined-risk condor found at these deltas right now.`;

  return {
    ok: true,
    strategy: 'iron_condor',
    asset,
    expiry,
    delta_target: { put: putDelta, call: callDelta },
    legs: [
      { action: 'SELL', type: 'P', strike: shortPut.strike, delta: shortPut.delta, bid: shortPut.bid, instrument: shortPut.instrument || null },
      { action: 'BUY', type: 'P', strike: longPut.strike, delta: longPut.delta, ask: longPut.ask, instrument: longPut.instrument || null },
      { action: 'SELL', type: 'C', strike: shortCall.strike, delta: shortCall.delta, bid: shortCall.bid, instrument: shortCall.instrument || null },
      { action: 'BUY', type: 'C', strike: longCall.strike, delta: longCall.delta, ask: longCall.ask, instrument: longCall.instrument || null },
    ],
    spot,
    credit_usd: Number(creditUsd.toFixed(2)),
    max_loss_usd: Number(maxLossUsd.toFixed(2)),
    risk_reward: riskReward != null ? Number(riskReward.toFixed(3)) : null,
    breakevens: { lower: Number(lowerBreakeven.toFixed(2)), upper: Number(upperBreakeven.toFixed(2)) },
    approx_prob_in_range: Number(probInRange.toFixed(3)),
    decision: { action, confidence: Number(probInRange.toFixed(3)), reasoning },
    disclaimer: 'Structure built from live option quotes. NOT investment advice and NOT a return guarantee; options can lose the full max loss. Probability is an approximation from option deltas. You execute on your own Deribit account.',
  };
}
