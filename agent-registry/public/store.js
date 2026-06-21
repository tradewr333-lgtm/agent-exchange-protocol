(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const usd = (n) => '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const STATE = { quote: null, templates: [], agents: [], hireQuote: null, wallet: null };

  async function getJSON(url) { try { const r = await fetch(url); return await r.json(); } catch { return null; } }
  async function postJSON(url, body) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json(); return { status: r.status, ...d };
    } catch (e) { return { status: 0, error: 'network_error', detail: String(e) }; }
  }

  // ---- wallet (MetaMask / BSC) ----
  const BSC = { chainId: '0x38', chainName: 'BNB Smart Chain', nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 }, rpcUrls: ['https://bsc-dataseed.binance.org'], blockExplorerUrls: ['https://bscscan.com'] };

  function hasWallet() { return typeof window.ethereum !== 'undefined'; }

  async function connectWallet() {
    if (!hasWallet()) throw new Error('No wallet found. Install MetaMask.');
    const accts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    setWallet(accts[0]);
    return accts[0];
  }

  async function ensureBSC() {
    try {
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BSC.chainId }] });
    } catch (e) {
      if (e && e.code === 4902) await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [BSC] });
      else throw e;
    }
  }

  function setWallet(addr) {
    STATE.wallet = addr || null;
    $('wallet-dot').style.background = addr ? 'var(--green)' : '';
    $('wallet-text').textContent = addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : 'wallet not connected';
    refreshPlanBadge(addr);
  }

  // Live hosting-subscription badge: pulsing green when active, red when the card
  // failed on renewal (past_due/canceled) — i.e. hosting access is suspended.
  async function refreshPlanBadge(owner) {
    const el = $('plan-badge');
    if (!el) return;
    const txt = $('plan-badge-text');
    if (!owner) { el.style.display = 'none'; return; }
    const d = await getJSON(`/billing/subscription?owner=${encodeURIComponent(owner)}`);
    if (!d || !d.has_subscription) { el.style.display = 'none'; return; }
    el.style.display = 'inline-flex';
    if (d.active) {
      el.className = 'plan-badge ok';
      const name = (d.plan_name || 'Hosting').replace(' Hosting', '').replace(' + Scale', '');
      txt.textContent = `${name} · ${d.slots} slot${d.slots === 1 ? '' : 's'} active`;
      el.title = 'Hosting subscription active';
    } else {
      el.className = 'plan-badge bad';
      txt.textContent = d.status === 'past_due' ? 'Payment failed — hosting suspended' : 'Hosting inactive';
      el.title = 'Renew your card to restore hosting';
    }
  }

  function toBaseUnits(amount, decimals) {
    const [w, f = ''] = String(amount).split('.');
    const fp = (f + '0'.repeat(decimals)).slice(0, decimals);
    return BigInt((w || '0') + fp);
  }
  const pad32 = (h) => h.replace(/^0x/, '').toLowerCase().padStart(64, '0');

  async function payBNB(from, to, amount) {
    const value = '0x' + toBaseUnits(amount, 18).toString(16);
    return window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from, to, value }] });
  }
  async function payToken(from, token, to, amount, decimals) {
    const data = '0xa9059cbb' + pad32(to) + pad32(toBaseUnits(amount, decimals).toString(16));
    return window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from, to: token, data }] });
  }
  async function waitReceipt(tx) {
    for (let i = 0; i < 40; i += 1) {
      const r = await window.ethereum.request({ method: 'eth_getTransactionReceipt', params: [tx] });
      if (r) return r;
      await sleep(3000);
    }
    return null;
  }

  // ---- modal ----
  function openModal(title, html) { $('modal-title').textContent = title; $('modal-body').innerHTML = html; $('modal').style.display = 'grid'; }
  function closeModal() { $('modal').style.display = 'none'; }

  // ---- launch flow ----
  function openLaunch(template) {
    const q = STATE.quote;
    if (!q || !q.enabled) {
      openModal(`Launch ${template.name}`, `<p class="note err">Launch payments are not configured on this server yet (missing treasury). Once configured, you'll pay $49 in BNB/USDT/USDC here.</p>`);
      return;
    }
    const assets = q.options.map((o) =>
      `<button class="btn asset-btn" data-asset="${o.asset}">${o.asset} · ${o.amount}</button>`).join('');
    openModal(`Launch ${template.name}`, `
      <p class="note">Pay the one-time launch fee (~$49) on BNB Smart Chain, then AXP creates your agent: identity, wallet, API key, public page, and a live connection to the Opportunity Router.</p>
      <div class="asset-row">${assets}</div>
      <div id="launch-status" class="note"></div>
    `);
    document.querySelectorAll('.asset-btn').forEach((b) => {
      b.onclick = () => doLaunch(template, b.getAttribute('data-asset'));
    });
  }

  async function doLaunch(template, asset) {
    const st = $('launch-status');
    const opt = STATE.quote.options.find((o) => o.asset === asset);
    try {
      st.innerHTML = 'Connecting wallet…';
      const from = await connectWallet();
      await ensureBSC();
      st.innerHTML = `Sending ${opt.amount} ${asset} to the AXP treasury — confirm in your wallet…`;
      const tx = asset === 'BNB'
        ? await payBNB(from, STATE.quote.treasury, opt.amount)
        : await payToken(from, opt.token_address, STATE.quote.treasury, opt.amount, opt.decimals);
      st.innerHTML = `Payment sent (<code class="k">${esc(tx)}</code>) — waiting for confirmation on BSC…`;
      const receipt = await waitReceipt(tx);
      if (!receipt) { st.innerHTML = '<span class="err">Timed out waiting for confirmation. If the tx confirmed, retry the launch with the same payment.</span>'; return; }
      st.innerHTML = 'Payment confirmed. Launching your agent…';
      const res = await postJSON('/agents/launch', { template_id: template.id, owner_address: from, payment: { tx_hash: tx, asset } });
      if (res.ok) renderLaunchSuccess(res);
      else st.innerHTML = `<span class="err">Launch failed: ${esc(res.error || 'unknown')}${res.detail ? ' — ' + esc(res.detail) : ''}</span>`;
    } catch (e) {
      st.innerHTML = `<span class="err">${esc(e.message || String(e))}</span>`;
    }
  }

  function renderLaunchSuccess(res) {
    const a = res.agent;
    openModal('🎉 Agent launched', `
      <p class="ok">${esc(a.name)} is live and in the AXP graph.</p>
      <p class="note">Agent ID: <strong>${esc(a.agent_id)}</strong><br>Wallet: <code class="k">${esc(a.operator)}</code></p>
      ${res.api_key ? `<p class="note">API key (shown once — save it):</p><code class="k">${esc(res.api_key)}</code>` : ''}
      <p class="note">Keep it earning with Hosting — your subscription auto-hosts every agent you own, up to the plan limit:</p>
      <div class="asset-row">
        <button class="btn primary" data-sku="hosting_starter">Host · Starter $9/mo · 1 agent</button>
        <button class="btn" data-sku="hosting_pro">Pro $29/mo · 5 agents</button>
        <button class="btn" data-sku="trust_api">Scale $99/mo · 100 + API</button>
      </div>
      <p class="note"><a href="${esc(a.public_page || ('/agent/' + a.agent_id))}" style="color:var(--cyan)">View its public page →</a></p>
    `);
    document.querySelectorAll('[data-sku]').forEach((b) => { b.onclick = () => subscribe(b.getAttribute('data-sku')); });
  }

  // ---- hosting (Stripe), OWNER-scoped ----
  // A subscription grants slots to your WALLET; AXP auto-hosts the agents you own
  // up to the plan limit (Starter 1 / Pro 5 / Trust API 100). No per-agent checkout.
  async function subscribe(sku) {
    let owner;
    try { owner = STATE.wallet || await connectWallet(); }
    catch (e) {
      openModal('Connect your wallet', `<p class="note err">${esc(e.message || 'Wallet required')}</p><p class="note">Hosting is tied to your wallet — it owns your agents. Connect the same wallet you launch with, and AXP keeps your agents hosted up to your plan's limit automatically.</p>`);
      return;
    }
    const res = await postJSON('/billing/checkout', { plan_sku: sku, owner_ref: owner });
    if (res.ok && res.url) { window.location.href = res.url; return; }
    openModal('Hosting checkout', `<p class="note err">Could not start checkout: ${esc(res.error || 'unknown')}.</p><p class="note">${res.error === 'stripe_disabled' ? 'Stripe is not configured on the server yet (set STRIPE_SECRET_KEY).' : res.error === 'price_not_configured' ? 'The plan price id is not set on the server.' : ''}</p>`);
  }

  // ---- renderers ----
  function renderTemplates() {
    $('templates').innerHTML = STATE.templates.map((t) => `
      <div class="card">
        <div class="tname"><span class="ticon">${esc(t.icon || t.name[0])}</span>${esc(t.name)}</div>
        <div class="tdesc">${esc(t.tagline)}</div>
        <div class="tstats"><span class="chip cyan">${esc(t.service)}</span><span class="chip">cap ${usd(t.capacity_usd)}</span></div>
        <button class="btn primary block" data-tpl="${esc(t.id)}">Launch — $49</button>
      </div>`).join('');
    document.querySelectorAll('[data-tpl]').forEach((b) => {
      b.onclick = () => openLaunch(STATE.templates.find((t) => t.id === b.getAttribute('data-tpl')));
    });
  }

  function renderGaps(opps) {
    if (!opps || !opps.length) return;
    $('gaps-section').style.display = '';
    $('gaps-spacer').style.display = '';
    $('gaps-tag').textContent = `${opps.length} niches`;
    $('gaps').innerHTML = opps.map((o) => {
      const tpl = STATE.templates.find((t) => t.id === o.template_id);
      const name = tpl ? tpl.name : o.category;
      const g = o.growth_pct >= 0 ? `+${o.growth_pct}%` : `${o.growth_pct}%`;
      return `<div class="card">
        <div class="tname">${esc(name)}</div>
        <div class="tstats"><span class="chip coral">gap ${Number(o.opportunity_gap).toLocaleString()}</span><span class="chip amber">growth ${g}</span></div>
        <div class="note">demand ${Number(o.demand_units).toLocaleString()} · supply ${o.active_agents} agents · ${esc((o.external_sources || []).join(', ') || 'on-ledger')}</div>
        <button class="btn primary block" data-gap-tpl="${esc(o.template_id)}">Launch ${esc(name)} — $49</button>
      </div>`;
    }).join('');
    document.querySelectorAll('[data-gap-tpl]').forEach((b) => {
      b.onclick = () => { const t = STATE.templates.find((x) => x.id === b.getAttribute('data-gap-tpl')); if (t) openLaunch(t); };
    });
  }

  function renderHosting(plans, trustApi) {
    const card = (p) => `
      <div class="hostplan">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <strong>${esc(p.name)}</strong>
          <span class="price">$${p.usd_month}<span>/mo</span></span>
        </div>
        <div class="note">${(p.includes || []).map((i) => '· ' + esc(i)).join('<br>')}</div>
        <button class="btn block" data-host="${esc(p.sku)}" style="margin-top:10px">Subscribe</button>
      </div>`;
    $('hosting').innerHTML = (plans || []).map(card).join('') + (trustApi ? card(trustApi) : '');
    document.querySelectorAll('[data-host]').forEach((b) => {
      b.onclick = () => subscribe(b.getAttribute('data-host'));
    });
  }

  function ratingStars(a) {
    if (!a.contracts) return 'new';
    const r = Math.max(0, Math.min(5, (a.success_rate || 0) * 5));
    const full = Math.round(r);
    return '★'.repeat(full) + '☆'.repeat(5 - full) + ` ${r.toFixed(1)}`;
  }
  function badges(a) {
    const b = [];
    if (a.status === 'active') b.push('<span class="chip green">active</span>');
    if (a.hosting && a.hosting.active) b.push('<span class="chip cyan">hosted</span>');
    if ((a.trust_score || 0) >= 50) b.push('<span class="chip amber">verified</span>');
    if (a.launched) b.push('<span class="chip">launched</span>');
    return b.join(' ');
  }
  function agentCardHtml(a) {
    return `<a class="card" href="/agent/${esc(a.agent_id)}" style="text-decoration:none">
      <div class="tname">${esc(a.name)}</div>
      <div class="tstats">${badges(a)}</div>
      <div class="tstats">
        <span class="chip green">${usd(a.revenue_usd)} settled</span>
        <span class="chip">${a.contracts} interactions</span>
        <span class="chip amber">trust ${Math.round(a.trust_score)}</span>
      </div>
      <div class="note">${(a.services || []).join(', ')} · ${ratingStars(a)} · success ${(a.success_rate * 100).toFixed(0)}%</div>
      ${a.last_work && a.last_work.preview ? `<div class="note" style="opacity:.75">“${esc(a.last_work.preview.slice(0, 90))}…”</div>` : ''}
    </a>`;
  }
  function renderAgents(list) {
    STATE.agents = list || [];
    const cats = [...new Set(STATE.agents.flatMap((a) => a.services || []))].sort();
    $('agents').innerHTML = `
      <div class="dir-controls">
        <input id="dir-search" placeholder="Search agents…" autocomplete="off">
        <select id="dir-cat"><option value="">All categories</option>${cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>
        <select id="dir-sort">
          <option value="settled">Top earning</option>
          <option value="trust">Highest trust</option>
          <option value="contracts">Most active</option>
          <option value="name">Name</option>
        </select>
      </div>
      <div class="cards" id="agents-grid"></div>`;
    $('dir-search').oninput = renderGrid;
    $('dir-cat').onchange = renderGrid;
    $('dir-sort').onchange = renderGrid;
    renderGrid();
  }
  function renderGrid() {
    const q = ($('dir-search').value || '').toLowerCase();
    const cat = $('dir-cat').value;
    const sort = $('dir-sort').value;
    let items = STATE.agents.filter((a) => {
      if (cat && !(a.services || []).includes(cat)) return false;
      if (q && !(`${a.name || ''} ${(a.services || []).join(' ')} ${a.template || ''}`).toLowerCase().includes(q)) return false;
      return true;
    });
    const by = {
      settled: (x, y) => y.revenue_usd - x.revenue_usd,
      trust: (x, y) => y.trust_score - x.trust_score,
      contracts: (x, y) => y.contracts - x.contracts,
      name: (x, y) => (x.name || '').localeCompare(y.name || ''),
    };
    items.sort(by[sort] || by.settled);
    $('agents-tag').textContent = `${items.length} agents`;
    $('agents-grid').innerHTML = items.length
      ? items.slice(0, 48).map(agentCardHtml).join('')
      : '<div class="empty">No agents match your search.</div>';
  }

  // ---- hire this agent (REAL paid job) ----
  async function openHire(agentId, name) {
    const q = await getJSON(`/agents/${agentId}/hire/quote`);
    if (!q || !q.enabled) { openModal('Hire agent', '<p class="note err">Hiring is not configured on this server yet.</p>'); return; }
    if (!q.llm_ready) { openModal('Hire agent', '<p class="note err">This agent can\'t execute right now (LLM not configured on the server).</p>'); return; }
    STATE.hireQuote = q;
    const assets = q.options.map((o) => `<button class="btn asset-h" data-asset="${o.asset}">${o.asset} · ${o.amount}</button>`).join('');
    openModal(`Hire ${name}`, `
      <p class="note">Describe your task. You pay ~$${q.usd}; the owner keeps ${Math.round((1 - q.fee_rate) * 100)}%, AXP keeps ${Math.round(q.fee_rate * 100)}%. The agent does the work with AI and returns the result here.</p>
      <textarea id="hire-task" rows="4" placeholder="e.g. Translate to Spanish: 'Welcome to our product...'" style="width:100%;background:rgba(150,200,214,0.05);border:1px solid var(--line);border-radius:10px;padding:10px;color:var(--text);font:inherit;font-size:13px"></textarea>
      <p class="note" style="margin-top:8px">Pay & run:</p>
      <div class="asset-row">${assets}</div>
      <div id="hire-status" class="note"></div>
      <div id="hire-result"></div>`);
    document.querySelectorAll('.asset-h').forEach((b) => { b.onclick = () => doHire(agentId, b.getAttribute('data-asset')); });
  }

  async function doHire(agentId, asset) {
    const st = $('hire-status');
    const task = ($('hire-task').value || '').trim();
    if (!task) { st.innerHTML = '<span class="err">Describe the task first.</span>'; return; }
    const opt = STATE.hireQuote.options.find((o) => o.asset === asset);
    try {
      st.innerHTML = 'Connecting wallet…';
      const from = await connectWallet();
      await ensureBSC();
      st.innerHTML = `Paying ${opt.amount} ${asset} — confirm in your wallet…`;
      const tx = asset === 'BNB'
        ? await payBNB(from, STATE.hireQuote.treasury, opt.amount)
        : await payToken(from, opt.token_address, STATE.hireQuote.treasury, opt.amount, opt.decimals);
      st.innerHTML = 'Payment sent — waiting for confirmation on BSC…';
      const rec = await waitReceipt(tx);
      if (!rec) { st.innerHTML = '<span class="err">Timed out waiting for confirmation. If it confirmed, retry.</span>'; return; }
      st.innerHTML = 'Confirmed. The agent is working…';
      const res = await postJSON(`/agents/${agentId}/hire`, { task, payment: { tx_hash: tx, asset }, customer_address: from });
      if (res.ok) {
        const pay = res.payout && res.payout.paid ? `Owner paid on-chain ✓ (${res.payout.tx_hash.slice(0, 12)}…)` : 'Owner balance accrued (payout pending).';
        st.innerHTML = `<span class="ok">Done! Owner earned ${res.owner_earned} ${res.asset} (~$${res.owner_earned_usd}) · AXP fee ${res.platform_fee} ${res.asset}. ${pay}</span>`;
        $('hire-result').innerHTML = `<div class="muted" style="font-size:11px;margin-top:12px">DELIVERABLE</div><code class="k" style="white-space:pre-wrap">${esc(res.deliverable)}</code>`;
      } else {
        st.innerHTML = `<span class="err">${esc(res.error || 'failed')}${res.detail ? ' — ' + esc(res.detail) : ''}</span>`;
      }
    } catch (e) {
      st.innerHTML = `<span class="err">${esc(e.message || String(e))}</span>`;
    }
  }

  // ---- agent product view ----
  async function renderAgentView(agentId) {
    $('view-store').style.display = 'none';
    $('view-agent').style.display = 'block';
    const a = await getJSON(`/agents/${agentId}/card`);
    if (!a || a.error) { $('agent-name').textContent = 'Agent not found'; return; }
    $('agent-name').textContent = a.name;
    $('agent-sub').textContent = `${(a.services || []).join(', ')}${a.template ? ' · template: ' + a.template : ''}`;
    $('agent-status-tag').textContent = a.hosting && a.hosting.active ? 'hosted · earning' : a.status;
    const kpi = (label, val) => `<div class="kpi"><div class="k-value">${val}</div><div class="k-label">${label}</div></div>`;
    $('agent-kpis').innerHTML =
      kpi('Real earnings', usd(a.real_earnings_usd)) +
      kpi('Settled volume', usd(a.revenue_usd)) +
      kpi('Contracts', a.contracts) +
      kpi('Success rate', (a.success_rate * 100).toFixed(0) + '%') +
      kpi('Trust score', Math.round(a.trust_score)) +
      kpi('Capacity', usd(a.capacity_usd));
    $('agent-detail').innerHTML = `
      <div class="note">
        Agent ID: <strong>${esc(a.agent_id)}</strong><br>
        Owner: <code class="k">${esc(a.owner || '—')}</code>
        Services: ${(a.services || []).join(', ')}<br>
        Hosting: ${a.hosting && a.hosting.active ? '<span class="ok">active (' + esc(a.hosting.plan || '') + ')</span>' : 'inactive'}
      </div>
      <div id="agent-opps" style="margin-top:14px"></div>
      ${a.last_work ? `<div style="margin-top:16px"><div class="muted" style="font-size:11px;margin-bottom:6px">LATEST DELIVERY ${a.last_work.model ? '· ' + esc(a.last_work.model) : ''} ${a.last_work.at ? '· ' + esc(new Date(a.last_work.at).toLocaleString()) : ''}</div>${a.last_work.task ? `<div class="note"><strong>Task:</strong> ${esc(a.last_work.task)}</div>` : ''}<code class="k" style="white-space:pre-wrap">${esc(a.last_work.preview || '')}</code></div>` : '<div class="note" style="margin-top:14px">No deliveries yet — subscribe to Hosting to put it to work.</div>'}
      <div class="asset-row" style="margin-top:16px">
        <button class="btn primary" id="hire-btn">⚡ Hire this agent</button>
      </div>
      <p class="note">Share to bring your own clients:</p>
      <div class="asset-row">
        <button class="btn" id="copy-link">📋 Copy hire link</button>
        <a class="btn" id="tweet-link" target="_blank" rel="noopener">Share on X</a>
      </div>
      <p class="note">Owner hosting (auto-hosts every agent you own, up to the plan limit):</p>
      <div class="asset-row">
        <button class="btn" data-sku="hosting_starter">Starter $9/mo · 1</button>
        <button class="btn" data-sku="hosting_pro">Pro $29/mo · 5</button>
        <button class="btn" data-sku="trust_api">Scale $99/mo · 100 + API</button>
      </div>`;
    $('hire-btn').onclick = () => openHire(a.agent_id, a.name);
    const hireLink = `${window.location.origin}/agent/${a.agent_id}`;
    $('copy-link').onclick = async () => {
      try { await navigator.clipboard.writeText(hireLink); $('copy-link').textContent = '✓ Copied!'; setTimeout(() => { $('copy-link').textContent = '📋 Copy hire link'; }, 1800); }
      catch { prompt('Copy this hire link:', hireLink); }
    };
    $('tweet-link').href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(`Hire my ${a.name} on AXP — real work, on-chain proof of trust:`)}&url=${encodeURIComponent(hireLink)}`;
    document.querySelectorAll('[data-sku]').forEach((b) => { b.onclick = () => subscribe(b.getAttribute('data-sku')); });

    // Opportunities delivered to this agent's owner (from the cloud BizDev Agent).
    (async () => {
      const inbox = await getJSON(`/inbox/${a.agent_id}`);
      const msgs = (inbox && (inbox.messages || inbox.inbox || (Array.isArray(inbox) ? inbox : []))) || [];
      const opps = msgs.filter((m) => m.kind === 'opportunity').slice(0, 8);
      if (opps.length) {
        $('agent-opps').innerHTML = `<div class="muted" style="font-size:11px;margin-bottom:6px">🎯 OPPORTUNITIES MATCHED TO THIS AGENT (${opps.length})</div>`
          + opps.map((o) => `<div class="note">• ${esc(o.subject || '')} ${o.ref_id ? `<a href="${esc(o.ref_id)}" target="_blank" rel="noopener" style="color:var(--cyan)">↗</a>` : ''}${o.data && o.data.summary ? `<br><span style="opacity:.7">${esc(o.data.summary)}</span>` : ''}</div>`).join('');
      }
    })();
  }

  async function showMyAgents() {
    try {
      const addr = (hasWallet() && window.ethereum.selectedAddress)
        ? window.ethereum.selectedAddress
        : await connectWallet();
      $('mine-section').style.display = '';
      $('mine-spacer').style.display = '';
      $('mine-tag').textContent = `${addr.slice(0, 6)}…${addr.slice(-4)}`;
      const data = await getJSON('/store/agents');
      const mine = (data && data.agents ? data.agents : []).filter((a) => (a.owner || '').toLowerCase() === addr.toLowerCase());
      $('mine-agents').innerHTML = mine.length
        ? mine.map(agentCardHtml).join('')
        : '<div class="empty">No agents owned by this wallet yet. Launch one above — then subscribe to Hosting to put it to work.</div>';
      $('mine-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      $('mine-section').style.display = '';
      $('mine-tag').textContent = 'connect wallet';
      $('mine-agents').innerHTML = `<div class="empty">${esc(e.message || 'Connect your wallet to see your agents.')}</div>`;
    }
  }

  async function initStore() {
    const [quote, plans, agents, observatory] = await Promise.all([
      getJSON('/agents/launch/quote'),
      getJSON('/billing/plans'),
      getJSON('/store/agents'),
      getJSON('/observatory'),
    ]);
    if (quote) { STATE.quote = quote; STATE.templates = quote.templates || []; renderTemplates(); }
    if (observatory) renderGaps(observatory.launch_opportunities || []);
    if (plans) {
      renderHosting(plans.hosting, plans.trust_api);
      if (plans.launch) $('launch-price').textContent = `Launch $${plans.launch.usd} one-time`;
    }
    renderAgents(agents ? agents.agents : []);
    if (hasWallet() && window.ethereum.selectedAddress) setWallet(window.ethereum.selectedAddress);
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') === 'success' || window.location.hash === '#mine' || (hasWallet() && window.ethereum.selectedAddress)) {
      showMyAgents();
    }
  }

  // route
  const m = window.location.pathname.match(/^\/agent\/([^/]+)$/);
  if (m) renderAgentView(m[1]);
  else initStore();

  $('modal-close').onclick = closeModal;
  $('modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };

  const navMine = $('nav-mine');
  if (navMine) navMine.onclick = (e) => {
    e.preventDefault();
    if ($('view-store').style.display === 'none') window.location.href = '/store#mine';
    else showMyAgents();
  };
})();
