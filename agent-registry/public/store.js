(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const usd = (n) => '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const STATE = { quote: null, templates: [] };

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
    $('wallet-dot').style.background = addr ? 'var(--green)' : '';
    $('wallet-text').textContent = addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : 'wallet not connected';
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
      <p class="note">Keep it earning with Hosting:</p>
      <div class="asset-row">
        <button class="btn primary" data-sku="hosting_starter">Host · Starter $9/mo</button>
        <button class="btn" data-sku="hosting_pro">Host · Pro $29/mo</button>
      </div>
      <p class="note"><a href="${esc(a.public_page || ('/agent/' + a.agent_id))}" style="color:var(--cyan)">View its public page →</a></p>
    `);
    document.querySelectorAll('[data-sku]').forEach((b) => { b.onclick = () => subscribe(b.getAttribute('data-sku'), a.agent_id); });
  }

  // ---- hosting (Stripe) ----
  async function subscribe(sku, agentId) {
    const res = await postJSON('/billing/checkout', { plan_sku: sku, agent_id: agentId || '' });
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
      b.onclick = () => {
        const sku = b.getAttribute('data-host');
        const agentId = prompt('Agent ID to host (launch one first, or leave blank):', '');
        subscribe(sku, agentId || '');
      };
    });
  }

  function renderAgents(list) {
    if (!list || list.length === 0) { $('agents').innerHTML = '<div class="empty">No agents yet — be the first to launch one.</div>'; return; }
    $('agents-tag').textContent = `${list.length} agents`;
    $('agents').innerHTML = list.slice(0, 24).map((a) => `
      <a class="card" href="/agent/${esc(a.agent_id)}" style="text-decoration:none">
        <div class="tname">${esc(a.name)} ${a.launched ? '<span class="chip cyan">launched</span>' : ''}</div>
        <div class="tstats">
          <span class="chip green">${usd(a.revenue_usd)} earned</span>
          <span class="chip">${a.contracts} contracts</span>
          <span class="chip amber">trust ${Math.round(a.trust_score)}</span>
        </div>
        <div class="note">${(a.services || []).join(', ')} · success ${(a.success_rate * 100).toFixed(0)}% · ${a.hosting && a.hosting.active ? '<span class="ok">hosted</span>' : 'idle'}</div>
      </a>`).join('');
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
      kpi('Revenue generated', usd(a.revenue_usd)) +
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
      ${a.last_work ? `<div style="margin-top:16px"><div class="muted" style="font-size:11px;margin-bottom:6px">LATEST DELIVERY ${a.last_work.model ? '· ' + esc(a.last_work.model) : ''} ${a.last_work.at ? '· ' + esc(new Date(a.last_work.at).toLocaleString()) : ''}</div>${a.last_work.task ? `<div class="note"><strong>Task:</strong> ${esc(a.last_work.task)}</div>` : ''}<code class="k" style="white-space:pre-wrap">${esc(a.last_work.preview || '')}</code></div>` : '<div class="note" style="margin-top:14px">No deliveries yet — subscribe to Hosting to put it to work.</div>'}
      <div class="asset-row" style="margin-top:14px">
        <button class="btn primary" data-sku="hosting_starter">Host · Starter $9/mo</button>
        <button class="btn" data-sku="hosting_pro">Host · Pro $29/mo</button>
      </div>`;
    document.querySelectorAll('[data-sku]').forEach((b) => { b.onclick = () => subscribe(b.getAttribute('data-sku'), a.agent_id); });
  }

  async function initStore() {
    const [quote, plans, agents] = await Promise.all([
      getJSON('/agents/launch/quote'),
      getJSON('/billing/plans'),
      getJSON('/store/agents'),
    ]);
    if (quote) { STATE.quote = quote; STATE.templates = quote.templates || []; renderTemplates(); }
    if (plans) {
      renderHosting(plans.hosting, plans.trust_api);
      if (plans.launch) $('launch-price').textContent = `Launch $${plans.launch.usd} one-time`;
    }
    renderAgents(agents ? agents.agents : []);
    if (hasWallet() && window.ethereum.selectedAddress) setWallet(window.ethereum.selectedAddress);
  }

  // route
  const m = window.location.pathname.match(/^\/agent\/([^/]+)$/);
  if (m) renderAgentView(m[1]);
  else initStore();

  $('modal-close').onclick = closeModal;
  $('modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };
})();
