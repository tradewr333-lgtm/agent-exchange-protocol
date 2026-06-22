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
import { liveCondor, placeOrder, getPositions, cancelAll } from './deribit-trade.js';

const activeBots = new Map(); // owner -> { interval, state }

function defaults(cfg = {}) {
  return {
    asset: (cfg.asset || 'BTC').toUpperCase(),
    contracts: Number(cfg.contracts) > 0 ? Number(cfg.contracts) : 0.1, // BTC per leg
    putDelta: Number(cfg.putDelta) || -0.12,
    callDelta: Number(cfg.callDelta) || 0.12,
    wingStrikes: Number(cfg.wingStrikes) || 1,
    profitTargetPct: Number(cfg.profitTargetPct) > 0 ? Number(cfg.profitTargetPct) : 50, // close at 50% of credit captured
    stopMult: Number(cfg.stopMult) > 0 ? Number(cfg.stopMult) : 2, // stop at -2x credit
    closeBeforeExpiryHours: Number(cfg.closeBeforeExpiryHours) > 0 ? Number(cfg.closeBeforeExpiryHours) : 6,
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
      if (pos.ok && (pos.positions || []).length > 0) { st.lastAction = 'flat-wait (existing option positions)'; return; }
      const sig = await liveCondor(creds, cfg.asset, { putDelta: cfg.putDelta, callDelta: cfg.callDelta, wingStrikes: cfg.wingStrikes });
      if (!sig.ok || sig.decision.action !== 'OPEN') { st.lastAction = 'no entry (' + (sig.error || sig.decision?.action) + ')'; return; }
      if (st.lastExpiryTraded === sig.expiry) { st.lastAction = 'already traded ' + sig.expiry; return; }

      const placed = [];
      for (const leg of sig.legs) {
        const inst = leg.instrument;
        const r = await placeOrder(creds, { instrument: inst, direction: leg.action === 'SELL' ? 'sell' : 'buy', amount: cfg.contracts, type: 'market', label: 'axp_ic' });
        placed.push({ instrument: inst, action: leg.action, ok: r.ok, error: r.error, avg: r.avg_price });
        if (!r.ok) { st.lastError = `leg ${inst} failed: ${r.error}`; }
      }
      const okLegs = placed.filter((p) => p.ok);
      if (okLegs.length === 4) {
        st.open = true; st.openedAt = Date.now(); st.expiry = sig.expiry; st.lastExpiryTraded = sig.expiry;
        st.legs = sig.legs.map((l) => ({ instrument: l.instrument, action: l.action, strike: l.strike }));
        st.creditUsd = sig.credit_usd * cfg.contracts;
        st.lastAction = `OPENED condor ${sig.expiry} credit $${st.creditUsd.toFixed(0)}`;
        if (saveState) await saveState(snapshot(st)).catch(() => {});
        save && save({ type: 'open', expiry: sig.expiry, price: sig.spot ?? null, size: cfg.contracts, credit_usd: Number(st.creditUsd.toFixed(2)), legs: st.legs, reason: 'Iron Condor opened' });
      } else {
        st.lastError = `only ${okLegs.length}/4 legs filled — unwinding`;
        await cancelAll(creds, { currency: cfg.asset, kind: 'option' });
        save && save({ type: 'error', reason: `Partial fill (${okLegs.length}/4) — cancelled`, legs: placed });
      }
      return;
    }

    // ── Open condor: monitor P&L and exit ──
    const floatingBtc = ours.reduce((s, p) => s + (Number(p.floating_pl) || 0), 0);
    st.currentPnlUsd = Number((floatingBtc).toFixed(2));
    if (ours.length === 0) {
      st.lastAction = 'positions closed externally';
      save && save({ type: 'closed_external', reason: 'Condor positions no longer open (expired or closed)' });
      resetOpen(st); if (saveState) await saveState(null).catch(() => {});
      return;
    }

    const profitTargetUsd = st.creditUsd * (cfg.profitTargetPct / 100);
    const stopUsd = -(st.creditUsd * cfg.stopMult);
    const hoursToExpiry = st.expiry ? hoursUntilExpiry(st.expiry) : 999;

    let exit = null;
    if (st.currentPnlUsd >= profitTargetUsd) exit = 'tp';
    else if (st.currentPnlUsd <= stopUsd) exit = 'sl';
    else if (hoursToExpiry <= cfg.closeBeforeExpiryHours) exit = 'expiry';

    if (exit) {
      for (const l of st.legs) {
        await placeOrder(creds, { instrument: l.instrument, direction: l.action === 'SELL' ? 'buy' : 'sell', amount: cfg.contracts, type: 'market', reduceOnly: true, label: 'axp_ic_close' });
      }
      st.lastAction = `CLOSED (${exit}) pnl $${st.currentPnlUsd.toFixed(0)}`;
      save && save({ type: exit, reason: `Closed (${exit})`, size: cfg.contracts, pnl_usd: st.currentPnlUsd });
      resetOpen(st); if (saveState) await saveState(null).catch(() => {});
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
export function getBotStatus(owner) {
  const e = activeBots.get(owner); if (!e) return null;
  const s = e.state;
  return { running: s.status === 'running', open: s.open, asset: s.config.asset, testnet: s.testnet, expiry: s.expiry, credit_usd: Number(s.creditUsd.toFixed(2)), pnl_usd: s.currentPnlUsd, legs: s.legs, last_action: s.lastAction, last_error: s.lastError, ticks: s.tickCount, config: s.config };
}
