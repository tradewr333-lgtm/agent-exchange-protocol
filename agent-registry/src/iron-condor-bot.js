// Iron Condor bot engine — per-user execution loop on Deribit.
// Mirrors the DegenScan tm-dca-engine state machine, adapted for a 4-leg options
// condor: OPEN (sell put+call spreads) → MONITOR P&L → CLOSE at profit target /
// stop / near expiry.
//
// Persistence: the OPEN condor state is saved to the cloud (Postgres) on every
// open/close. On a deploy/restart the bot RESUMES the same position — it never
// closes a trade that is still within its exit parameters.
//
// Honest + safe: only TRADE-only keys, small configurable size, no return promises.
import { liveCondor, placeOrder, getPositions, cancelAll, getIndexPrice } from './deribit-trade.js';

const activeBots = new Map(); // owner -> { interval, state }

function defaults(cfg = {}) {
  const asset = (cfg.asset || 'BTC').toUpperCase();
  // Deribit minimum order size / step: BTC options = 0.1, ETH options = 1.
  const step = asset === 'ETH' ? 1 : 0.1;
  let contracts = Number(cfg.contracts) > 0 ? Number(cfg.contracts) : step;
  contracts = Math.max(step, Math.round(contracts / step) * step); // snap to a valid multiple
  contracts = Number(contracts.toFixed(4));
  return {
    asset,
    contracts, // valid multiple of the exchange minimum (per leg)
    putDelta: Number(cfg.putDelta) || -0.12,
    callDelta: Number(cfg.callDelta) || 0.12,
    wingStrikes: Number(cfg.wingStrikes) || 1,
    profitTargetPct: Number(cfg.profitTargetPct) > 0 ? Number(cfg.profitTargetPct) : 50, // close at 50% of credit captured
    stopMult: Number(cfg.stopMult) > 0 ? Number(cfg.stopMult) : 2, // stop at -2x credit
    closeBeforeExpiryHours: Number(cfg.closeBeforeExpiryHours) > 0 ? Number(cfg.closeBeforeExpiryHours) : 6,
    // Hybrid expiry: near expiry, LET the condor expire (no exit fees) if spot is at least
    // this % inside BOTH short strikes; otherwise close early to dodge pin/gamma risk.
    expirySafetyPct: Number.isFinite(Number(cfg.expirySafetyPct)) ? Number(cfg.expirySafetyPct) : 1,
    // Fee-aware filter: only open if the expected profit at target, MINUS estimated
    // round-trip fees, clears this many USD. Skips thin condors that fees would eat.
    minNetUsd: Number.isFinite(Number(cfg.minNetUsd)) ? Number(cfg.minNetUsd) : 3,
    // Continuous mode: after a condor closes, automatically open the next one (same asset).
    autoReopen: cfg.autoReopen === false ? false : true,
  };
}

function createState(owner, cfg, restore = null, testnet = false) {
  const st = {
    owner, status: 'running', config: defaults(cfg), testnet: Boolean(testnet),
    open: false, legs: [], creditUsd: 0, openedAt: 0, expiry: null,
    currentPnlUsd: 0, lastExpiryTraded: null,
    tickCount: 0, lastTick: 0, lastError: null, lastAction: 'starting',
  };
  // Rehydrate an open condor saved before a restart.
  if (restore && restore.open && Array.isArray(restore.legs) && restore.legs.length) {
    st.open = true;
    st.legs = restore.legs;
    st.creditUsd = Number(restore.creditUsd) || 0;
    st.openedAt = Number(restore.openedAt) || Date.now();
    st.expiry = restore.expiry || null;
    st.lastExpiryTraded = restore.lastExpiryTraded || restore.expiry || null;
    st.lastAction = 'resumed open condor ' + (st.expiry || '');
  }
  return st;
}

function snapshot(st) {
  return st.open
    ? { open: true, legs: st.legs, creditUsd: st.creditUsd, openedAt: st.openedAt, expiry: st.expiry, lastExpiryTraded: st.lastExpiryTraded }
    : null;
}

async function botTick(st) {
  const cfg = st.config;
  const getCreds = st._getCreds, save = st._save, saveState = st._saveState;
  st.tickCount++; st.lastTick = Date.now();
  try {
    const creds = await getCreds(st.owner);
    if (!creds) { st.status = 'stopped'; st.lastError = 'no_credentials'; return; }

    const pos = await getPositions(creds, { currency: cfg.asset, kind: 'option' });
    const ours = st.open ? (pos.positions || []).filter((p) => st.legs.some((l) => l.instrument === p.instrument)) : [];

    // ── No open condor: maybe OPEN one ──
    if (!st.open) {
      // Stray option positions (e.g. legs left over from a previous partial fill) block a
      // clean condor. Flatten them (reduce-only) so the next tick starts from a clean slate.
      if (pos.ok && (pos.positions || []).length > 0) {
        for (const p of pos.positions) {
          await placeOrder(creds, { instrument: p.instrument, direction: p.direction === 'buy' ? 'sell' : 'buy', amount: Math.abs(Number(p.size) || cfg.contracts), type: 'market', reduceOnly: true, label: 'axp_ic_clean' });
        }
        st.lastAction = `flattened ${pos.positions.length} stray position(s)`;
        save && save({ type: 'cleanup', reason: `Closed ${pos.positions.length} stray option position(s) to reset` });
        return;
      }
      // Halted after an insufficient-funds failure — do NOT keep retrying (each failed
      // attempt costs real fees on the filled+unwound legs). Requires a manual re-START
      // (e.g. after adding margin) to clear.
      if (st.haltOpen) { st.lastAction = `paused: ${st.haltReason || 'add margin and press START again'}`; return; }
      const sig = await liveCondor(creds, cfg.asset, { putDelta: cfg.putDelta, callDelta: cfg.callDelta, wingStrikes: cfg.wingStrikes });
      if (!sig.ok || sig.decision.action !== 'OPEN') { st.lastAction = 'no entry (' + (sig.error || sig.decision?.action) + ')'; return; }
      if (st.lastExpiryTraded === sig.expiry) { st.lastAction = 'already traded ' + sig.expiry; return; }

      // ── Fee-aware filter ── Deribit charges min(0.0003 BTC, 12.5% of premium) PER leg.
      // A 4-leg condor pays fees on all 4 gross premiums but only nets the thin credit, so
      // we estimate round-trip fees and skip if the profit at target wouldn't clear them.
      const spot = Number(sig.spot) || 0;
      const FEE_CAP_BTC = 0.0003, FEE_RATE = 0.125;
      const legFeeBtc = (premium) => Math.min(FEE_CAP_BTC, FEE_RATE * Math.max(0, Number(premium) || 0)) * cfg.contracts;
      const openFeesBtc = sig.legs.reduce((s, l) => s + legFeeBtc(l.action === 'SELL' ? l.bid : l.ask), 0);
      const roundTripFeesUsd = openFeesBtc * spot * 2; // open + (~similar) close, conservative
      const targetProfitUsd = (cfg.profitTargetPct / 100) * Number(sig.credit_usd || 0);
      const netAtTargetUsd = targetProfitUsd - roundTripFeesUsd;
      if (netAtTargetUsd < cfg.minNetUsd) {
        st.lastAction = `skip (fees): target $${targetProfitUsd.toFixed(2)} − fees ~$${roundTripFeesUsd.toFixed(2)} = $${netAtTargetUsd.toFixed(2)} < min $${cfg.minNetUsd}`;
        save && save({ type: 'skip', reason: `Skipped ${sig.expiry}: net after fees ~$${netAtTargetUsd.toFixed(2)} (credit $${Number(sig.credit_usd).toFixed(2)}, est fees $${roundTripFeesUsd.toFixed(2)}) below min $${cfg.minNetUsd}` });
        return;
      }

      const placed = [];
      // Place the protective LONG wings (BUY) FIRST, then the SHORT legs (SELL). With the
      // longs already in the account, Deribit margins the shorts as a defined-risk spread
      // (far less margin) instead of as naked options — critical for smaller accounts.
      const ordered = [...sig.legs].sort((a, b) => (b.action === 'BUY') - (a.action === 'BUY'));
      for (const leg of ordered) {
        const inst = leg.instrument;
        const isSell = leg.action === 'SELL';
        // Marketable LIMIT: sell at the bid / buy at the ask, rounded to the Deribit
        // option tick (0.0005 BTC) so params are valid. Sell rounds DOWN, buy rounds UP
        // (stays marketable → crosses → fills). Fall back to market if no quote.
        const TICK = 0.0005;
        const raw = isSell ? Number(leg.bid) : Number(leg.ask);
        const px = raw > 0 ? Number((Math[isSell ? 'floor' : 'ceil'](raw / TICK) * TICK).toFixed(4)) : 0;
        const order = px >= TICK
          ? { instrument: inst, direction: isSell ? 'sell' : 'buy', amount: cfg.contracts, type: 'limit', price: px, timeInForce: 'immediate_or_cancel', label: 'axp_ic' }
          : { instrument: inst, direction: isSell ? 'sell' : 'buy', amount: cfg.contracts, type: 'market', label: 'axp_ic' };
        const r = await placeOrder(creds, order);
        const filled = Number(r.filled || 0);
        const ok = r.ok && filled > 0;
        placed.push({ instrument: inst, action: leg.action, ok, filled, error: r.ok ? (filled > 0 ? null : 'not_filled (no liquidity at price)') : r.error, detail: r.detail, avg: r.avg_price });
        if (!ok) { st.lastError = `leg ${inst}: ${r.ok ? 'not_filled' : r.error}${r.detail ? ' (' + r.detail + ')' : ''}`; }
      }
      const okLegs = placed.filter((p) => p.ok);
      if (okLegs.length === 4) {
        st.open = true; st.openedAt = Date.now(); st.expiry = sig.expiry; st.lastExpiryTraded = sig.expiry;
        st.legs = sig.legs.map((l) => ({ instrument: l.instrument, action: l.action, strike: l.strike, type: l.type }));
        st.creditUsd = sig.credit_usd * cfg.contracts;
        // Expected outcomes AFTER fees (honest, within probability):
        st.openFeesUsd = Number((openFeesBtc * spot).toFixed(2));
        st.winProb = Number.isFinite(Number(sig.approx_prob_in_range)) ? Number(sig.approx_prob_in_range) : null;
        st.expectedNetUsd = Number((st.creditUsd - st.openFeesUsd).toFixed(2)); // held to OTM expiry (no exit fee)
        st.expectedNetTargetUsd = Number(netAtTargetUsd.toFixed(2)); // closed at profit target (incl. exit fees)
        st.lastAction = `OPENED condor ${sig.expiry} credit $${st.creditUsd.toFixed(0)} · exp net ~$${st.expectedNetUsd.toFixed(2)} (${st.winProb != null ? Math.round(st.winProb * 100) + '% in range' : ''})`;
        if (saveState) await saveState(snapshot(st)).catch(() => {});
        save && save({ type: 'open', expiry: sig.expiry, price: sig.spot ?? null, size: cfg.contracts, credit_usd: Number(st.creditUsd.toFixed(2)), expected_net_usd: st.expectedNetUsd, win_prob: st.winProb, legs: st.legs, reason: `Iron Condor opened · expected net ~$${st.expectedNetUsd.toFixed(2)} after fees (${st.winProb != null ? Math.round(st.winProb * 100) + '% in range' : 'n/a'})` });
      } else {
        const errs = [...new Set(placed.filter((p) => !p.ok).map((p) => (p.error || '?') + (p.detail ? ` [${p.detail}]` : '')))].join('; ');
        st.lastError = `${okLegs.length}/4 filled — ${errs || 'no fills'}`;
        // Insufficient margin → HALT auto-retries to stop burning fees on repeated
        // open/unwind cycles. User must add funds and press START again.
        if (/not_enough_funds|insufficient/i.test(errs)) {
          st.haltOpen = true;
          st.haltReason = 'insufficient margin for this size — add funds (or lower size) and press START again';
        }
        // Cancel resting orders AND close any legs that actually FILLED (reduce-only) so we
        // never leave stray naked positions consuming margin.
        await cancelAll(creds, { currency: cfg.asset, kind: 'option' });
        for (const p of placed.filter((x) => x.ok)) {
          await placeOrder(creds, { instrument: p.instrument, direction: p.action === 'SELL' ? 'buy' : 'sell', amount: cfg.contracts, type: 'market', reduceOnly: true, label: 'axp_ic_unwind' });
        }
        save && save({ type: 'error', reason: `Open failed (${okLegs.length}/4): ${errs || 'no fills (liquidity/margin?)'} — filled legs closed`, legs: placed });
      }
      return;
    }

    // ── Open condor: monitor P&L and exit ──
    // Positions gone = expired or closed externally. Record the LAST measured floating P&L
    // as the realized estimate (e.g. a fully-OTM expiry leaves ~+credit before settlement).
    if (ours.length === 0) {
      st.lastAction = 'positions closed externally (expired/closed)';
      save && save({ type: 'closed_external', reason: 'Condor expired or closed on the exchange', pnl_usd: st.currentPnlUsd });
      resetOpen(st); if (saveState) await saveState(null).catch(() => {});
      if (!cfg.autoReopen) { st.haltOpen = true; st.haltReason = 'auto-reopen off — press START for another'; }
      return;
    }
    const floatingBtc = ours.reduce((s, p) => s + (Number(p.floating_pl) || 0), 0);
    st.currentPnlUsd = Number((floatingBtc).toFixed(2));

    const profitTargetUsd = st.creditUsd * (cfg.profitTargetPct / 100);
    const stopUsd = -(st.creditUsd * cfg.stopMult);
    const hoursToExpiry = st.expiry ? hoursUntilExpiry(st.expiry) : 999;

    let exit = null;
    if (st.currentPnlUsd >= profitTargetUsd) exit = 'tp';
    else if (st.currentPnlUsd <= stopUsd) exit = 'sl';
    else if (hoursToExpiry <= cfg.closeBeforeExpiryHours) {
      // Hybrid expiry: LET it expire (no exit fees) if spot is comfortably inside BOTH short
      // strikes; close early only if spot is near a short (pin/gamma risk).
      // Identify the short put/call by type, falling back to the instrument suffix
      // (…-P / …-C) so this also works for positions saved before `type` was stored.
      const isPut = (l) => l.type === 'P' || /-P$/i.test(l.instrument || '');
      const isCall = (l) => l.type === 'C' || /-C$/i.test(l.instrument || '');
      const shortPut = st.legs.find((l) => l.action === 'SELL' && isPut(l));
      const shortCall = st.legs.find((l) => l.action === 'SELL' && isCall(l));
      const spot = await getIndexPrice(creds, cfg.asset);
      if (Number.isFinite(spot) && shortPut && shortCall) {
        const buf = (cfg.expirySafetyPct || 0) / 100;
        const safelyInside = spot >= shortPut.strike * (1 + buf) && spot <= shortCall.strike * (1 - buf);
        if (safelyInside) {
          st.lastAction = `let-expire — spot ${spot.toFixed(0)} safely inside ${shortPut.strike}–${shortCall.strike} (${hoursToExpiry.toFixed(1)}h, saves fees)`;
        } else {
          exit = 'expiry'; // near a short strike → close to lock the result
        }
      } else {
        exit = 'expiry'; // can't read spot → safe default: close before expiry
      }
    }

    if (exit) {
      for (const l of st.legs) {
        await placeOrder(creds, { instrument: l.instrument, direction: l.action === 'SELL' ? 'buy' : 'sell', amount: cfg.contracts, type: 'market', reduceOnly: true, label: 'axp_ic_close' });
      }
      st.lastAction = `CLOSED (${exit}) pnl $${st.currentPnlUsd.toFixed(0)}`;
      save && save({ type: exit, reason: `Closed (${exit})`, size: cfg.contracts, pnl_usd: st.currentPnlUsd });
      resetOpen(st); if (saveState) await saveState(null).catch(() => {});
      if (!cfg.autoReopen) { st.haltOpen = true; st.haltReason = 'auto-reopen off — press START for another'; }
    } else {
      st.lastAction = `holding · pnl $${st.currentPnlUsd.toFixed(0)} · ${hoursToExpiry.toFixed(0)}h to expiry`;
    }
  } catch (e) {
    st.lastError = String(e?.message || e);
  }
}

function resetOpen(st) { st.open = false; st.legs = []; st.creditUsd = 0; st.openedAt = 0; st.expiry = null; st.currentPnlUsd = 0; }

// Deribit expiry code like "28JUN26" → hours until 08:00 UTC on that date.
function hoursUntilExpiry(code) {
  const m = String(code).match(/^(\d{1,2})([A-Z]{3})(\d{2})$/);
  if (!m) return 999;
  const months = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
  const d = Date.UTC(2000 + Number(m[3]), months[m[2]] ?? 0, Number(m[1]), 8, 0, 0);
  return (d - Date.now()) / 3_600_000;
}

// startBot(owner, cfg, getCreds, save, opts)
//   opts.saveState(snapshot|null) — persist open state to cloud
//   opts.restoreState            — previously saved open state (resume after restart)
//   opts.testnet, opts.intervalMs
export function startBot(owner, cfg, getCreds, save, opts = {}) {
  stopBot(owner);
  const state = createState(owner, cfg, opts.restoreState || null, opts.testnet);
  state._getCreds = getCreds; state._save = save; state._saveState = opts.saveState || null;
  const intervalMs = Number(opts.intervalMs) || 20_000;
  const loop = setInterval(() => { if (state.status === 'running') botTick(state).catch((e) => { state.lastError = String(e?.message || e); }); }, Math.max(10_000, intervalMs));
  if (loop.unref) loop.unref();
  botTick(state).catch(() => {});
  activeBots.set(owner, { interval: loop, state });
  return state;
}
export function stopBot(owner) {
  const e = activeBots.get(owner);
  if (e) { clearInterval(e.interval); e.state.status = 'stopped'; activeBots.delete(owner); return true; }
  return false;
}
export function isBotRunning(owner) { return activeBots.has(owner); }

// Hard kill: STOP the bot (so it can't auto-reopen) THEN flatten all option positions
// (reduce-only market) across BTC+ETH. Used by the "Close All & STOP" button.
export async function closeAllAndStop(owner, getCreds) {
  stopBot(owner); // stop first — guarantees no re-open while we flatten
  const creds = await getCreds(owner);
  if (!creds) return { ok: false, error: 'no_credentials' };
  const closed = [];
  for (const currency of ['BTC', 'ETH']) {
    try {
      await cancelAll(creds, { currency, kind: 'option' });
      const pos = await getPositions(creds, { currency, kind: 'option' });
      for (const p of (pos.positions || [])) {
        const amt = Math.abs(Number(p.size) || 0);
        if (amt <= 0) continue;
        const r = await placeOrder(creds, { instrument: p.instrument, direction: p.direction === 'buy' ? 'sell' : 'buy', amount: amt, type: 'market', reduceOnly: true, label: 'axp_ic_closeall' });
        closed.push({ instrument: p.instrument, ok: r.ok, error: r.error || null });
      }
    } catch (e) { closed.push({ currency, ok: false, error: String(e?.message || e) }); }
  }
  return { ok: true, closed };
}
export function getBotStatus(owner) {
  const e = activeBots.get(owner); if (!e) return null;
  const s = e.state;
  return { running: s.status === 'running', open: s.open, asset: s.config.asset, testnet: s.testnet, expiry: s.expiry, credit_usd: Number(s.creditUsd.toFixed(2)), pnl_usd: s.currentPnlUsd, expected_net_usd: s.expectedNetUsd ?? null, expected_net_target_usd: s.expectedNetTargetUsd ?? null, win_prob: s.winProb ?? null, auto_reopen: s.config.autoReopen, legs: s.legs, last_action: s.lastAction, last_error: s.lastError, ticks: s.tickCount, config: s.config };
}
