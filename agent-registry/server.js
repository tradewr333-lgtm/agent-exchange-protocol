import http from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyAgentManifest } from './src/agent-manifest.js';
import { registerAgent, updateAgentHeartbeat } from './src/agents.js';
import { getApiKey, registerApiKey, requireApiKey, rotateApiKey } from './src/api-keys.js';
import { buildAuthMessage } from './src/auth.js';
import { getEconomicPolicy } from './src/economics.js';
import { getAgentRiskReport, getAgentTrustScore, getBestAgent, getTrustRanking } from './src/trust-score.js';
import {
  getPreparedContract,
  listPreparedContracts,
  prepareContract,
  quoteContract,
  settleContract,
} from './src/contracts.js';
import { getAgent, getCapabilities, listAgents, readJsonFile } from './src/registry.js';
import { listApiUsage, listTrustEvents } from './src/store.js';

const port = Number.parseInt(process.env.PORT ?? '4180', 10);
const currentDir = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(currentDir, '..', '.well-known', 'axp.json');
const publicPath = join(currentDir, 'public');

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://localhost:${port}`);

  if (request.method === 'OPTIONS') {
    return sendJson(response, 204, {});
  }

  if (url.pathname === '/') {
    return sendHtml(response, 200, readFileSync(join(publicPath, 'index.html'), 'utf8'));
  }

  if (url.pathname === '/dashboard') {
    return sendHtml(response, 200, await buildDashboardHtml());
  }

  if (url.pathname === '/styles.css') {
    return sendAsset(response, 'text/css; charset=utf-8', readFileSync(join(publicPath, 'styles.css'), 'utf8'));
  }

  if (url.pathname === '/app.js') {
    return sendAsset(response, 'application/javascript; charset=utf-8', readFileSync(join(publicPath, 'app.js'), 'utf8'));
  }

  if (url.pathname === '/health') {
    return sendJson(response, 200, { ok: true, protocol: 'AXP', service: 'agent-registry' });
  }

  if (url.pathname === '/.well-known/axp.json') {
    return sendJson(response, 200, readJsonFile(manifestPath));
  }

  if (url.pathname === '/capabilities') {
    return sendJson(response, 200, getCapabilities());
  }

  if (url.pathname === '/economics') {
    return sendJson(response, 200, getEconomicPolicy());
  }

  if (url.pathname === '/trust-ranking') {
    const apiKey = await requireApiKey(request, 'trust_ranking', { path: url.pathname });
    if (!apiKey.ok) {
      return sendJson(response, apiKey.status, apiKey);
    }

    const minScore = url.searchParams.has('min_score')
      ? Number.parseFloat(url.searchParams.get('min_score'))
      : undefined;
    const limit = url.searchParams.has('limit')
      ? Number.parseInt(url.searchParams.get('limit'), 10)
      : undefined;

    return sendJson(response, 200, await getTrustRanking({
      status: url.searchParams.get('status') ?? undefined,
      service: url.searchParams.get('service') ?? undefined,
      online: parseBooleanParam(url.searchParams.get('online')),
      minScore,
      limit,
    }));
  }

  if (url.pathname === '/trust-events') {
    const apiKey = await requireApiKey(request, 'trust_events', { path: url.pathname });
    if (!apiKey.ok) {
      return sendJson(response, apiKey.status, apiKey);
    }

    return sendJson(response, 200, await listTrustEvents({
      agentId: url.searchParams.get('agent_id') ?? undefined,
      eventType: url.searchParams.get('event_type') ?? undefined,
      contractId: url.searchParams.get('contract_id') ?? undefined,
      counterpartyId: url.searchParams.get('counterparty_id') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    }));
  }

  if (url.pathname === '/api-usage') {
    const apiKey = await requireApiKey(request, 'api_usage', { path: url.pathname });
    if (!apiKey.ok) {
      return sendJson(response, apiKey.status, apiKey);
    }

    return sendJson(response, 200, await listApiUsage({
      keyId: url.searchParams.get('key_id') ?? undefined,
      usageType: url.searchParams.get('usage_type') ?? undefined,
      agentId: url.searchParams.get('agent_id') ?? undefined,
      path: url.searchParams.get('path') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    }));
  }

  if (url.pathname === '/best-agent') {
    const apiKey = await requireApiKey(request, 'best_agent', { path: url.pathname });
    if (!apiKey.ok) {
      return sendJson(response, apiKey.status, apiKey);
    }

    const requestedCapacity = url.searchParams.has('requested_capacity')
      ? Number.parseFloat(url.searchParams.get('requested_capacity'))
      : undefined;
    const limit = url.searchParams.has('limit')
      ? Number.parseInt(url.searchParams.get('limit'), 10)
      : undefined;

    return sendJson(response, 200, await getBestAgent({
      task: url.searchParams.get('task') ?? undefined,
      service: url.searchParams.get('service') ?? undefined,
      online: parseBooleanParam(url.searchParams.get('online')),
      requestedCapacity,
      limit,
    }));
  }

  if (request.method === 'POST' && url.pathname === '/auth/message') {
    const body = await readJsonBody(request);
    const validation = validateAuthMessageBody(body);
    if (!validation.ok) {
      return sendJson(response, validation.status, validation);
    }

    return sendJson(response, 200, {
      protocol: 'AXP',
      version: '0.1.0',
      message: buildAuthMessage({
        action: body.action,
        agentId: body.agent_id,
        address: body.address,
        nonce: body.nonce,
        issuedAt: body.issued_at,
        scope: body.scope,
      }),
    });
  }

  if (url.pathname === '/agents') {
    const apiKey = await requireApiKey(request, 'agent_query', { path: url.pathname });
    if (!apiKey.ok) {
      return sendJson(response, apiKey.status, apiKey);
    }

    const minCapacity = url.searchParams.has('min_capacity')
      ? Number.parseFloat(url.searchParams.get('min_capacity'))
      : undefined;

    return sendJson(response, 200, await listAgents({
      status: url.searchParams.get('status') ?? undefined,
      service: url.searchParams.get('service') ?? undefined,
      minCapacity,
      online: parseBooleanParam(url.searchParams.get('online')),
    }));
  }

  if (request.method === 'POST' && url.pathname === '/agents/register') {
    const body = await readJsonBody(request);
    const result = await registerAgent(body);
    return sendJson(response, result.status, result.ok ? result.agent : result);
  }

  if (request.method === 'POST' && url.pathname === '/agents/verify-manifest') {
    const body = await readJsonBody(request);
    const result = await verifyAgentManifest(body ?? {});
    return sendJson(response, result.status ?? 200, result);
  }

  if (request.method === 'POST' && url.pathname === '/api-keys/register') {
    const body = await readJsonBody(request);
    const result = await registerApiKey(body);
    return sendJson(response, result.status, result.ok ? result : result);
  }

  const apiKeyMatch = url.pathname.match(/^\/api-keys\/([^/]+)$/);
  if (apiKeyMatch) {
    const apiKey = await getApiKey(apiKeyMatch[1]);
    if (!apiKey) {
      return sendJson(response, 404, { error: 'api_key_not_found', key_id: apiKeyMatch[1] });
    }
    return sendJson(response, 200, apiKey);
  }

  const apiKeyRotateMatch = url.pathname.match(/^\/api-keys\/([^/]+)\/rotate$/);
  if (request.method === 'POST' && apiKeyRotateMatch) {
    const body = await readJsonBody(request);
    const result = await rotateApiKey(apiKeyRotateMatch[1], body);
    return sendJson(response, result.status, result.ok ? result : result);
  }

  const agentMatch = url.pathname.match(/^\/agents\/([^/]+)$/);
  if (agentMatch) {
    const agent = await getAgent(agentMatch[1]);
    if (!agent) {
      return sendJson(response, 404, { error: 'agent_not_found', agent_id: agentMatch[1] });
    }
    return sendJson(response, 200, agent);
  }

  const heartbeatMatch = url.pathname.match(/^\/agents\/([^/]+)\/heartbeat$/);
  if (request.method === 'POST' && heartbeatMatch) {
    const body = await readJsonBody(request);
    const result = await updateAgentHeartbeat(heartbeatMatch[1], body);
    return sendJson(response, result.status, result.ok ? result.agent : result);
  }

  const agentTrustEventsMatch = url.pathname.match(/^\/agents\/([^/]+)\/trust-events$/);
  if (agentTrustEventsMatch) {
    const apiKey = await requireApiKey(request, 'trust_events', { path: url.pathname, agent_id: agentTrustEventsMatch[1] });
    if (!apiKey.ok) {
      return sendJson(response, apiKey.status, apiKey);
    }

    return sendJson(response, 200, await listTrustEvents({
      agentId: agentTrustEventsMatch[1],
      eventType: url.searchParams.get('event_type') ?? undefined,
      contractId: url.searchParams.get('contract_id') ?? undefined,
      counterpartyId: url.searchParams.get('counterparty_id') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    }));
  }

  const trustScoreMatch = url.pathname.match(/^\/agents\/([^/]+)\/trust-score$/);
  if (trustScoreMatch) {
    const apiKey = await requireApiKey(request, 'trust_score', { path: url.pathname, agent_id: trustScoreMatch[1] });
    if (!apiKey.ok) {
      return sendJson(response, apiKey.status, apiKey);
    }

    const trustScore = await getAgentTrustScore(trustScoreMatch[1]);
    if (!trustScore) {
      return sendJson(response, 404, { error: 'agent_not_found', agent_id: trustScoreMatch[1] });
    }
    return sendJson(response, 200, trustScore);
  }

  const trustScoreAliasMatch = url.pathname.match(/^\/trust-score\/([^/]+)$/);
  if (trustScoreAliasMatch) {
    const apiKey = await requireApiKey(request, 'trust_score', { path: url.pathname, agent_id: trustScoreAliasMatch[1] });
    if (!apiKey.ok) {
      return sendJson(response, apiKey.status, apiKey);
    }

    const trustScore = await getAgentTrustScore(trustScoreAliasMatch[1]);
    if (!trustScore) {
      return sendJson(response, 404, { error: 'agent_not_found', agent_id: trustScoreAliasMatch[1] });
    }
    return sendJson(response, 200, trustScore);
  }

  const riskReportMatch = url.pathname.match(/^\/risk-report\/([^/]+)$/);
  if (riskReportMatch) {
    const apiKey = await requireApiKey(request, 'risk_report', { path: url.pathname, agent_id: riskReportMatch[1] });
    if (!apiKey.ok) {
      return sendJson(response, apiKey.status, apiKey);
    }

    const riskReport = await getAgentRiskReport(riskReportMatch[1]);
    if (!riskReport) {
      return sendJson(response, 404, { error: 'agent_not_found', agent_id: riskReportMatch[1] });
    }
    return sendJson(response, 200, riskReport);
  }

  if (request.method === 'POST' && url.pathname === '/contracts/quote') {
    const body = await readJsonBody(request);
    const result = await quoteContract(body);
    return sendJson(response, result.status, result.ok ? result.quote : result);
  }

  if (request.method === 'POST' && url.pathname === '/contracts/prepare') {
    const body = await readJsonBody(request);
    const result = await prepareContract(body);
    return sendJson(response, result.status, result.ok ? result.contract : result);
  }

  if (url.pathname === '/contracts') {
    return sendJson(response, 200, await listPreparedContracts());
  }

  const settleMatch = url.pathname.match(/^\/contracts\/([^/]+)\/settle$/);
  if (request.method === 'POST' && settleMatch) {
    const body = await readJsonBody(request);
    const result = await settleContract(settleMatch[1], body);
    return sendJson(response, result.status, result.ok ? result.contract : result);
  }

  const contractMatch = url.pathname.match(/^\/contracts\/([^/]+)$/);
  if (contractMatch) {
    const contract = await getPreparedContract(contractMatch[1]);
    if (!contract) {
      return sendJson(response, 404, { error: 'contract_not_found', contract_id: contractMatch[1] });
    }
    return sendJson(response, 200, contract);
  }

  return sendJson(response, 404, {
    error: 'not_found',
    endpoints: [
      '/.well-known/axp.json',
      '/dashboard',
      '/health',
      '/capabilities',
      '/economics',
      '/trust-ranking',
      '/trust-events',
      '/api-usage',
      '/trust-score/{agent_id}',
      '/risk-report/{agent_id}',
      '/best-agent',
      'POST /api-keys/register',
      '/api-keys/{key_id}',
      'POST /api-keys/{key_id}/rotate',
      'POST /auth/message',
      '/agents',
      'POST /agents/register',
      'POST /agents/verify-manifest',
      '/agents/{agent_id}',
      'POST /agents/{agent_id}/heartbeat',
      '/agents/{agent_id}/trust-events',
      '/agents/{agent_id}/trust-score',
      'POST /contracts/quote',
      'POST /contracts/prepare',
      '/contracts',
      '/contracts/{contract_id}',
      'POST /contracts/{contract_id}/settle',
    ],
  });
});

server.listen(port, () => {
  console.log(`AXP agent registry running at http://localhost:${port}`);
});

function sendJson(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, x-axp-api-key',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

async function buildDashboardHtml() {
  const capabilities = getCapabilities();
  const agents = await listAgents({});
  const contracts = await listPreparedContracts();
  const ranking = await getTrustRanking({ limit: 5 });
  const trustEvents = await listTrustEvents({ limit: 8 });
  const apiUsage = await listApiUsage({ limit: 8 });
  const latestAgents = [...agents.agents]
    .sort((left, right) => compareDates(right.registered_at ?? right.updated_at, left.registered_at ?? left.updated_at))
    .slice(0, 6);
  const latestContracts = [...contracts.contracts]
    .sort((left, right) => compareDates(
      right.settled_at ?? right.prepared_at ?? right.created_at,
      left.settled_at ?? left.prepared_at ?? left.created_at,
    ))
    .slice(0, 6);
  const storageLabel = capabilities.storage.postgres_enabled ? 'Postgres active' : 'JSON fallback';
  const storageClass = capabilities.storage.postgres_enabled ? 'good' : 'warn';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>AXP Dashboard</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #05090a;
        --panel: #0d1417;
        --panel-2: #121c20;
        --line: #26383d;
        --text: #f4fbf8;
        --muted: #9cafad;
        --mint: #89f7bd;
        --cyan: #8fe8ff;
        --amber: #f4ca64;
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at 15% 20%, rgba(137, 247, 189, 0.14), transparent 26rem),
          radial-gradient(circle at 85% 5%, rgba(143, 232, 255, 0.12), transparent 24rem),
          var(--bg);
        color: var(--text);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      a { color: inherit; text-decoration: none; }

      .shell {
        width: min(1180px, calc(100% - 32px));
        margin: 0 auto;
        padding: 32px 0 48px;
      }

      .topbar, .hero, .section, .metric {
        border: 1px solid var(--line);
        background: rgba(13, 20, 23, 0.82);
        backdrop-filter: blur(18px);
      }

      .topbar {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: center;
        padding: 14px 16px;
        margin-bottom: 18px;
      }

      .brand { display: flex; align-items: center; gap: 12px; font-weight: 800; }
      .brand-mark { border: 1px solid #376b64; color: var(--mint); padding: 8px 10px; }
      .nav { display: flex; flex-wrap: wrap; gap: 8px; }
      .nav a, .quick-links a {
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.03);
        padding: 9px 11px;
        color: var(--muted);
        font-size: 13px;
      }

      .hero {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 20px;
        padding: 26px;
        margin-bottom: 18px;
      }

      h1 { margin: 0 0 8px; font-size: clamp(34px, 6vw, 76px); line-height: 0.95; letter-spacing: 0; }
      h2 { margin: 0; font-size: 17px; letter-spacing: 0; }
      p { color: var(--muted); line-height: 1.6; margin: 0; }
      .eyebrow { color: var(--mint); font-size: 12px; font-weight: 800; text-transform: uppercase; }
      .timestamp { margin-top: 12px; font-size: 13px; }

      .metrics {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
        margin-bottom: 18px;
      }

      .metric { padding: 16px; min-height: 108px; }
      .metric span { color: var(--muted); font-size: 12px; text-transform: uppercase; font-weight: 800; }
      .metric strong { display: block; margin-top: 10px; font-size: 28px; }
      .metric small { color: var(--muted); }

      .grid {
        display: grid;
        grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
        gap: 18px;
      }

      .section { padding: 18px; overflow: hidden; }
      .section.wide { grid-column: 1 / -1; }
      .section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
      .pill {
        border: 1px solid var(--line);
        padding: 6px 8px;
        font-size: 12px;
        color: var(--muted);
      }
      .pill.good { color: var(--mint); border-color: rgba(137, 247, 189, 0.4); }
      .pill.warn { color: var(--amber); border-color: rgba(244, 202, 100, 0.4); }

      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th, td { border-bottom: 1px solid rgba(38, 56, 61, 0.7); padding: 11px 8px; text-align: left; vertical-align: top; }
      th { color: var(--muted); font-size: 11px; text-transform: uppercase; }
      td { color: #dce8e5; }
      code { color: var(--cyan); font-family: "SFMono-Regular", Consolas, monospace; font-size: 12px; word-break: break-word; }
      .empty { border: 1px dashed var(--line); color: var(--muted); padding: 16px; }
      .score { color: var(--mint); font-weight: 800; }
      .quick-links { display: flex; flex-wrap: wrap; gap: 10px; }

      @media (max-width: 860px) {
        .hero, .grid { grid-template-columns: 1fr; }
        .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .topbar { align-items: flex-start; flex-direction: column; }
      }

      @media (max-width: 520px) {
        .metrics { grid-template-columns: 1fr; }
        th:nth-child(3), td:nth-child(3) { display: none; }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <header class="topbar">
        <a class="brand" href="/">
          <span class="brand-mark">AXP</span>
          <span>Operational Dashboard</span>
        </a>
        <nav class="nav" aria-label="Dashboard navigation">
          <a href="/">Home</a>
          <a href="/capabilities">Capabilities</a>
          <a href="/trust-ranking">Trust Ranking</a>
          <a href="/.well-known/axp.json">Manifest</a>
        </nav>
      </header>

      <section class="hero">
        <div>
          <p class="eyebrow">Proof of Trust ledger</p>
          <h1>AXP Dashboard</h1>
          <p>Live operational view of the AXP Trust Oracle: registered agents, contracts, API usage, and the recent trust events that make Proof of Trust auditable.</p>
          <p class="timestamp">Generated at ${escapeHtml(new Date().toISOString())}</p>
        </div>
        <span class="pill ${storageClass}">${escapeHtml(storageLabel)}</span>
      </section>

      <section class="metrics" aria-label="AXP metrics">
        ${renderMetric('Storage', storageLabel, capabilities.storage.schema)}
        ${renderMetric('Agents', agents.count, 'registered in registry')}
        ${renderMetric('Contracts', contracts.contracts.length, 'prepared or settled')}
        ${renderMetric('Trust Events', trustEvents.count, 'recent ledger rows')}
      </section>

      <main class="grid">
        <section class="section">
          <div class="section-head">
            <h2>Top Agents by Trust Score</h2>
            <span class="pill">Proof of Trust</span>
          </div>
          ${renderTable(
            ['Rank', 'Agent', 'Score', 'Online'],
            ranking.agents,
            (agent) => [
              `#${agent.rank}`,
              `<code>${escapeHtml(agent.agent_id)}</code><br>${escapeHtml(agent.agent_name ?? '')}`,
              `<span class="score">${formatNumber(agent.proof_of_trust_score)}</span>`,
              agent.online ? '<span class="pill good">online</span>' : '<span class="pill warn">offline</span>',
            ],
            'No ranked agents yet.',
          )}
        </section>

        <section class="section">
          <div class="section-head">
            <h2>Latest Agents</h2>
            <span class="pill">${agents.count} total</span>
          </div>
          ${renderTable(
            ['Agent', 'Services', 'Collateral', 'Status'],
            latestAgents,
            (agent) => [
              `<code>${escapeHtml(agent.agent_id)}</code><br>${escapeHtml(agent.name ?? '')}`,
              escapeHtml((agent.services ?? []).join(', ') || 'none'),
              `${escapeHtml(agent.collateral?.asset ?? 'n/a')} ${formatNumber(agent.collateral?.amount ?? agent.collateral_usd ?? 0)}`,
              `<span class="pill ${agent.online ? 'good' : 'warn'}">${agent.online ? 'online' : escapeHtml(agent.status ?? 'offline')}</span>`,
            ],
            'No registered agents yet.',
          )}
        </section>

        <section class="section wide">
          <div class="section-head">
            <h2>Latest Contracts</h2>
            <span class="pill">${contracts.contracts.length} total</span>
          </div>
          ${renderTable(
            ['Contract', 'Provider', 'Service', 'Status', 'Value'],
            latestContracts,
            (contract) => [
              `<code>${escapeHtml(contract.contract_id)}</code>`,
              `<code>${escapeHtml(contract.quote?.provider_agent_id ?? contract.provider_agent_id ?? 'n/a')}</code>`,
              escapeHtml(contract.quote?.service ?? contract.terms?.service ?? 'n/a'),
              `<span class="pill">${escapeHtml(contract.status ?? 'prepared')}</span>`,
              `$${formatNumber(contract.quote?.requested_capacity ?? contract.terms?.requested_capacity ?? 0)}`,
            ],
            'No contracts prepared yet.',
          )}
        </section>

        <section class="section">
          <div class="section-head">
            <h2>Recent Trust Events</h2>
            <span class="pill">ledger</span>
          </div>
          ${renderTable(
            ['Type', 'Agent', 'Contract', 'When'],
            trustEvents.events,
            (event) => [
              escapeHtml(event.event_type ?? 'event'),
              `<code>${escapeHtml(event.agent_id ?? 'n/a')}</code>`,
              `<code>${escapeHtml(event.contract_id ?? 'n/a')}</code><br>$${formatNumber(event.value_usd ?? 0)}`,
              escapeHtml(formatDate(event.created_at)),
            ],
            'No trust events recorded yet.',
          )}
        </section>

        <section class="section">
          <div class="section-head">
            <h2>Recent API Usage</h2>
            <span class="pill">metering</span>
          </div>
          ${renderTable(
            ['Type', 'Key', 'Path', 'When'],
            apiUsage.usage,
            (usage) => [
              escapeHtml(usage.usage_type ?? 'request'),
              `<code>${escapeHtml(usage.key_id ?? 'n/a')}</code>`,
              `<code>${escapeHtml(usage.path ?? 'n/a')}</code>`,
              escapeHtml(formatDate(usage.created_at)),
            ],
            'No API usage recorded yet.',
          )}
        </section>

        <section class="section wide">
          <div class="section-head">
            <h2>Quick Links</h2>
            <span class="pill">API key required for protected JSON endpoints</span>
          </div>
          <div class="quick-links">
            <a href="/capabilities">Capabilities</a>
            <a href="/trust-ranking">Trust Ranking</a>
            <a href="/trust-events">Trust Events</a>
            <a href="/api-usage">API Usage</a>
            <a href="/agents">Agents</a>
            <a href="/.well-known/axp.json">Manifest</a>
          </div>
        </section>
      </main>
    </div>
  </body>
</html>`;
}

function renderMetric(label, value, note) {
  return `<article class="metric">
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(value)}</strong>
    <small>${escapeHtml(note)}</small>
  </article>`;
}

function renderTable(headers, rows, renderRow, emptyText) {
  if (!rows || rows.length === 0) {
    return `<div class="empty">${escapeHtml(emptyText)}</div>`;
  }

  return `<table>
    <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
    <tbody>
      ${rows.map((row) => `<tr>${renderRow(row).map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}
    </tbody>
  </table>`;
}

function compareDates(left, right) {
  return Date.parse(left ?? '') - Date.parse(right ?? '');
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'n/a';
  }

  return date.toISOString();
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '0';
  }

  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(number);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function parseBooleanParam(value) {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return undefined;
}

function sendHtml(response, status, body) {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
  });
  response.end(body);
}

function sendAsset(response, contentType, body) {
  response.writeHead(200, {
    'content-type': contentType,
    'cache-control': 'public, max-age=300',
  });
  response.end(body);
}

function readJsonBody(request) {
  return new Promise((resolve) => {
    let body = '';

    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 64_000) {
        request.destroy();
        resolve(null);
      }
    });

    request.on('end', () => {
      if (!body.trim()) {
        return resolve({});
      }

      try {
        return resolve(JSON.parse(body));
      } catch {
        return resolve(null);
      }
    });

    request.on('error', () => resolve(null));
  });
}

function validateAuthMessageBody(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, status: 400, error: 'invalid_json_body' };
  }

  for (const field of ['action', 'agent_id', 'address', 'nonce', 'issued_at', 'scope']) {
    if (!body[field] || typeof body[field] !== 'string') {
      return { ok: false, status: 400, error: `${field}_required` };
    }
  }

  return { ok: true };
}
