// AXP live network dashboard — everything here is read live from the registry.
// No mock data: real agents, real lineage, real on-ledger trust events.
(() => {
  const REFRESH_MS = 12000;
  const $ = (id) => document.getElementById(id);

  async function getJSON(path) {
    try {
      const res = await fetch(path, { headers: { accept: 'application/json' } });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  const fmt = (n) => {
    const v = Number(n) || 0;
    if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'k';
    return String(Math.round(v * 100) / 100);
  };
  const usd = (n) => '$' + fmt(n);
  const shortHash = (h) => (!h ? '—' : (h.length > 18 ? h.slice(0, 10) + '…' + h.slice(-6) : h));
  const ago = (iso) => {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- force-directed graph (canvas) ----------
  const canvas = $('graph');
  const gctx = canvas.getContext('2d');
  let GW = 0, GH = 0, ratio = 1;
  const G = { nodes: new Map(), edges: [] };

  function sizeGraph() {
    ratio = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    GW = rect.width; GH = rect.height;
    canvas.width = Math.floor(GW * ratio);
    canvas.height = Math.floor(GH * ratio);
    gctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  window.addEventListener('resize', sizeGraph);

  function syncGraph(lineage, agents) {
    const seen = new Set();
    const upsert = (id, label, type, weight) => {
      seen.add(id);
      let n = G.nodes.get(id);
      if (!n) {
        n = {
          id, label, type, weight,
          x: GW / 2 + (Math.random() - 0.5) * 220,
          y: GH / 2 + (Math.random() - 0.5) * 160,
          vx: 0, vy: 0, fresh: 60,
        };
        G.nodes.set(id, n);
      } else {
        n.label = label; n.type = type; n.weight = weight;
      }
      return n;
    };

    const lin = (lineage && lineage.nodes) || [];
    for (const node of lin) {
      const type = node.sponsor_agent_id ? 'scion' : 'root';
      upsert(node.agent_id, node.handle || node.agent_id, type, 6 + Math.min(18, Number(node.discovery_earnings_axp) || 0));
    }
    const ag = (agents && agents.agents) || [];
    for (const a of ag) {
      if (G.nodes.has(a.agent_id)) continue;
      upsert(a.agent_id, a.name || a.agent_id, 'agent', 5 + Math.min(12, (Number(a.trust_score ?? a.proof_of_trust_score) || 0) / 1000));
    }
    // prune nodes that vanished
    for (const id of [...G.nodes.keys()]) if (!seen.has(id)) G.nodes.delete(id);
    G.edges = ((lineage && lineage.edges) || []).filter((e) => G.nodes.has(e.from) && G.nodes.has(e.to));
    $('graph-tag').textContent = G.nodes.size + ' nodes';
  }

  const COLOR = { root: '#5ff4e0', scion: '#b79bff', agent: '#84c9ff' };

  function stepGraph() {
    const nodes = [...G.nodes.values()];
    const cx = GW / 2, cy = GH / 2;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      a.vx += (cx - a.x) * 0.0016;
      a.vy += (cy - a.y) * 0.0016;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let d2 = dx * dx + dy * dy || 0.01;
        const d = Math.sqrt(d2);
        const f = Math.min(2.4, 1400 / d2);
        const ux = dx / d, uy = dy / d;
        a.vx += ux * f; a.vy += uy * f;
        b.vx -= ux * f; b.vy -= uy * f;
      }
    }
    for (const e of G.edges) {
      const a = G.nodes.get(e.from), b = G.nodes.get(e.to);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const target = 96;
      const f = (d - target) * 0.012;
      const ux = dx / d, uy = dy / d;
      a.vx += ux * f; a.vy += uy * f;
      b.vx -= ux * f; b.vy -= uy * f;
    }
    for (const n of nodes) {
      n.vx *= 0.86; n.vy *= 0.86;
      n.x += n.vx; n.y += n.vy;
      n.x = Math.max(20, Math.min(GW - 20, n.x));
      n.y = Math.max(20, Math.min(GH - 20, n.y));
      if (n.fresh > 0) n.fresh -= 1;
    }
  }

  function drawGraph() {
    gctx.clearRect(0, 0, GW, GH);
    for (const e of G.edges) {
      const a = G.nodes.get(e.from), b = G.nodes.get(e.to);
      if (!a || !b) continue;
      const grad = gctx.createLinearGradient(a.x, a.y, b.x, b.y);
      grad.addColorStop(0, 'rgba(95,244,224,0.34)');
      grad.addColorStop(1, 'rgba(183,155,255,0.30)');
      gctx.strokeStyle = grad;
      gctx.lineWidth = 1;
      gctx.beginPath(); gctx.moveTo(a.x, a.y); gctx.lineTo(b.x, b.y); gctx.stroke();
    }
    for (const n of G.nodes.values()) {
      const c = COLOR[n.type] || '#84c9ff';
      const r = n.weight;
      const glow = n.fresh > 0 ? 22 : 12;
      gctx.shadowColor = c; gctx.shadowBlur = glow;
      gctx.fillStyle = c;
      gctx.beginPath(); gctx.arc(n.x, n.y, r, 0, Math.PI * 2); gctx.fill();
      gctx.shadowBlur = 0;
      if (r >= 8 || n.type === 'root') {
        gctx.fillStyle = 'rgba(238,245,246,0.82)';
        gctx.font = '11px ui-monospace, monospace';
        const lbl = n.label.replace('axp://', '').slice(0, 22);
        gctx.fillText(lbl, n.x + r + 4, n.y + 3);
      }
    }
  }

  function loop() { stepGraph(); drawGraph(); requestAnimationFrame(loop); }

  // ---------- panels ----------
  function renderKpis(d) {
    const agents = d.agents?.count ?? 0;
    const events = d.events?.count ?? 0;
    const eventsLabel = events >= 500 ? '500+' : String(events);
    const intents = d.intents?.count ?? 0;
    const scions = ((d.lineage?.nodes) || []).filter((n) => n.sponsor_agent_id).length;
    const treasury = d.metrics?.treasury?.remaining_axp ?? 0;
    const gdp = d.gdp_usd ?? 0;

    const cards = [
      ['Economic Agents', String(agents), 'identities on the registry', true],
      ['Trust Events', eventsLabel, 'cryptographically hashed', false],
      ['Open Intents', String(intents), 'machine-readable work', false],
      ['Scions Spawned', String(scions), 'via Genesis Cascade', true],
      ['Settled GDP', usd(gdp), 'real settled volume', false],
      ['Treasury', fmt(treasury) + ' AXP', 'discovery reward budget', false],
    ];
    $('kpis').innerHTML = cards.map(([l, v, s, a]) =>
      `<div class="kpi"><div class="k-label">${l}</div><div class="k-value ${a ? 'accent' : ''}">${v}</div><div class="k-sub">${s}</div></div>`
    ).join('');
  }

  function renderGauge(metrics) {
    const k = Number(metrics?.k_factor) || 0;
    const target = Number(metrics?.target_k) || 1.5;
    const ring = $('k-ring');
    ring.style.setProperty('--val', k);
    ring.style.setProperty('--max', Math.max(target, k, 1));
    $('k-num').textContent = k.toFixed(2);
    const status = metrics?.viral_status === 'expanding' ? 'expanding ✦' : 'sub-critical';
    $('k-meta').innerHTML =
      `Viral coefficient <b>K = ${k.toFixed(2)}</b><br>target <b>${target}</b> · status <b>${status}</b><br>` +
      `reward × <b>${(Number(metrics?.incentive?.reward_multiplier) || 1).toFixed(2)}</b> · depth <b>${metrics?.incentive?.max_depth ?? 5}</b>`;
  }

  function renderTreasury(metrics) {
    const t = metrics?.treasury || {};
    const util = (Number(t.utilization) || 0) * 100;
    $('treasury').innerHTML =
      `<div class="bar-row"><span>Spent</span><div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, util).toFixed(2)}%"></div></div><span class="num">${fmt(t.spent_axp)} </span></div>` +
      `<div class="row"><div class="lhs"><span class="title">Remaining</span></div><div class="rhs"><span class="chip cyan">${fmt(t.remaining_axp)} AXP</span></div></div>` +
      `<div class="row"><div class="lhs"><span class="title">Budget</span></div><div class="rhs"><span class="chip">${fmt(t.budget_axp)} AXP</span></div></div>`;
  }

  function renderOpportunities(graph) {
    const matches = (graph?.suggested_matches) || [];
    const spawns = (graph?.spawn_opportunities) || [];
    $('opp-tag').textContent = `${graph?.stats?.open_intents ?? 0} open · ${graph?.stats?.spawn_opportunities ?? 0} spawn`;
    let html = '<div class="rows">';
    if (!matches.length && !spawns.length) html += '<div class="empty">No open opportunities right now.</div>';
    for (const m of matches.slice(0, 6)) {
      html += `<div class="row"><div class="lhs"><span class="title">${esc(m.title)}</span>` +
        `<span class="meta">${esc(m.service || '—')} · ${esc((m.best_agent?.agent_name) || '')}</span></div>` +
        `<div class="rhs"><span class="chip green">match ${Math.round(m.best_agent?.match_score || 0)}</span> <span class="chip">${usd(m.reward_usd)}</span></div></div>`;
    }
    for (const s of spawns.slice(0, 4)) {
      html += `<div class="row"><div class="lhs"><span class="title">${esc(s.title)}</span>` +
        `<span class="meta">${esc(s.service || '—')} · ${esc((s.unmet_reasons || []).join(', '))}</span></div>` +
        `<div class="rhs"><span class="chip coral">spawn signal</span> <span class="chip">${usd(s.reward_usd)}</span></div></div>`;
    }
    html += '</div>';
    $('opportunities').innerHTML = html;
  }

  let lastTopHash = null;
  function renderLedger(events) {
    const list = (events?.events) || [];
    if (!list.length) { $('ledger').innerHTML = '<div class="empty">Ledger is in JSON mode or empty.</div>'; return; }
    const typeChip = (t) => t === 'contract_settled' ? 'green' : t === 'contract_failed' ? 'coral' : t === 'scion_spawned' ? 'cyan' : '';
    $('ledger').innerHTML = list.slice(0, 12).map((e) => {
      const flash = e.event_hash && e.event_hash !== lastTopHash ? '' : '';
      return `<div class="row ${flash}"><div class="lhs"><span class="title">${esc(e.event_type)}</span>` +
        `<span class="meta">${esc(e.agent_id || '—')} · ${ago(e.created_at)}</span></div>` +
        `<div class="rhs">${Number(e.value_usd) ? `<span class="chip">${usd(e.value_usd)}</span> ` : ''}` +
        `<span class="hash">${shortHash(e.event_hash)}</span> <span class="chip ${typeChip(e.event_type)}">${esc(e.event_type.split('_')[0])}</span></div></div>`;
    }).join('');
    lastTopHash = list[0]?.event_hash || null;
  }

  function renderRanking(ranking) {
    const list = (ranking?.agents) || [];
    if (!list.length) { $('ranking').innerHTML = '<div class="empty">No ranked agents yet.</div>'; return; }
    $('ranking').innerHTML = list.slice(0, 8).map((a) =>
      `<div class="row"><div class="lhs"><span class="title">#${a.rank} ${esc(a.agent_name || a.agent_id)}</span>` +
      `<span class="meta">${esc(a.agent_id)}</span></div>` +
      `<div class="rhs"><span class="chip cyan">${fmt(a.proof_of_trust_score)}</span></div></div>`
    ).join('');
  }

  function renderHeatmap(events) {
    const counts = {};
    for (const e of (events?.events) || []) counts[e.event_type] = (counts[e.event_type] || 0) + 1;
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (!entries.length) { $('heatmap').innerHTML = '<div class="empty">No ledger activity.</div>'; return; }
    const max = entries[0][1] || 1;
    $('heatmap').innerHTML = entries.map(([k, v]) =>
      `<div class="bar-row"><span>${esc(k)}</span><div class="bar-track"><div class="bar-fill" style="width:${(v / max * 100).toFixed(1)}%"></div></div><span class="num">${v}</span></div>`
    ).join('');
  }

  const scanFor = (chainId) => (Number(chainId) === 97 ? 'https://testnet.bscscan.com' : 'https://bscscan.com');

  function renderAnchor(anchor, anchors) {
    const tag = $('anchor-tag');
    const list = Array.isArray(anchors) ? anchors.filter((a) => a && a.merkle_root) : [];
    const latest = (anchor && anchor.merkle_root) ? anchor : list[0];
    if (!latest || !latest.merkle_root) {
      tag.textContent = 'not yet anchored';
      $('anchor').innerHTML = '<div class="empty">No on-chain anchor recorded yet. Run the anchor flow to commit a Merkle root of the trust-event ledger to BSC.</div>';
      return;
    }
    const scan = scanFor(latest.chain_id);
    tag.textContent = `${list.length || 1} recorded`;
    const rows = [
      ['Merkle root', `<span class="hash">${esc(latest.merkle_root)}</span>`],
      ['Events covered', `${esc(latest.event_count)} (ids ${esc(latest.from_event_id)}–${esc(latest.to_event_id)})`],
      ['Network', Number(latest.chain_id) === 97 ? 'BSC testnet (97)' : 'BSC mainnet (56)'],
    ];
    if (latest.tx_hash) rows.push(['Transaction', `<a href="${scan}/tx/${esc(latest.tx_hash)}" target="_blank" rel="noopener">${shortHash(latest.tx_hash)} ↗</a>`]);
    if (latest.contract_address) rows.push(['Anchor contract', `<a href="${scan}/address/${esc(latest.contract_address)}" target="_blank" rel="noopener">${shortHash(latest.contract_address)} ↗</a>`]);
    if (latest.block_number) rows.push(['Block', esc(latest.block_number)]);

    let html = '<div class="rows">' + rows.map(([k, v]) =>
      `<div class="row"><div class="lhs"><span class="title">${k}</span></div><div class="rhs">${v}</div></div>`
    ).join('') + '</div>';

    if (list.length > 1) {
      html += '<div style="margin-top:14px;color:var(--faint);font-size:11px;letter-spacing:1.4px;text-transform:uppercase">History</div><div class="rows">';
      html += list.slice(0, 8).map((a) => {
        const s = scanFor(a.chain_id);
        const txCell = a.tx_hash
          ? `<a href="${s}/tx/${esc(a.tx_hash)}" target="_blank" rel="noopener" class="hash">${shortHash(a.tx_hash)} ↗</a>`
          : `<span class="chip">${esc(a.status || 'prepared')}</span>`;
        return `<div class="row"><div class="lhs"><span class="meta">${esc(a.merkle_root)}</span>` +
          `<span class="meta">${esc(a.event_count)} events · ids ${esc(a.from_event_id)}–${esc(a.to_event_id)}</span></div>` +
          `<div class="rhs">${txCell}</div></div>`;
      }).join('') + '</div>';
    }
    $('anchor').innerHTML = html;
  }

  function setStatus(d) {
    const dot = $('status-dot'), text = $('status-text');
    const ok = d.agents || d.metrics;
    const mode = d.storage_mode || 'unknown';
    const top = (d.events?.events || [])[0]?.event_hash;
    if (ok) {
      dot.className = 'dot';
      text.textContent = `${mode} ledger · ${top ? shortHash(top) : 'live'} · refresh 12s`;
    } else {
      dot.className = 'dot warn';
      text.textContent = 'registry unreachable';
    }
  }

  async function load() {
    const live = await getJSON('/network/live');
    if (!live) { setStatus({}); return; }
    const d = {
      storage_mode: live.storage_mode,
      agents: live.agents,
      events: live.events,
      ranking: live.ranking,
      opportunities: live.opportunities,
      metrics: live.metrics,
      lineage: live.lineage,
      intents: live.intents,
      gdp_usd: live.gdp_usd,
      anchor: live.anchor,
      anchors: live.anchors,
    };
    setStatus(d);
    renderKpis(d);
    renderGauge(d.metrics);
    renderTreasury(d.metrics);
    renderAnchor(d.anchor, d.anchors);
    renderOpportunities(d.opportunities);
    renderLedger(d.events);
    renderRanking(d.ranking);
    renderHeatmap(d.events);
    syncGraph(d.lineage, d.agents);
  }

  sizeGraph();
  loop();
  load();
  setInterval(load, REFRESH_MS);
})();
