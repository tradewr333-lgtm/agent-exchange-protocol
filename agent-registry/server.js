import http from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyAgentManifest } from './src/agent-manifest.js';
import { registerAgent, updateAgentHeartbeat } from './src/agents.js';
import { getApiKey, registerApiKey, requireApiKey, rotateApiKey } from './src/api-keys.js';
import { buildAuthMessage } from './src/auth.js';
import { getLatestAnchor, listTrustAnchors, prepareTrustAnchorBatch, recordTrustAnchor } from './src/anchors.js';
import { assignChallengeTask, listChallengeTasks, submitChallengeTask } from './src/challenge.js';
import { getEconomicPolicy } from './src/economics.js';
import { getAgentPassport, performAxpHandshake } from './src/passport.js';
import { getAgentRiskReport, getAgentTrustScore, getBestAgent, getTrustRanking } from './src/trust-score.js';
import {
  acceptContract,
  fundContract,
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

  if (url.pathname === '/network') {
    return sendHtml(response, 200, await buildNetworkHtml());
  }

  if (url.pathname === '/challenge') {
    return sendHtml(response, 200, buildChallengeHtml());
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

  if (url.pathname === '/challenge/tasks') {
    return sendJson(response, 200, listChallengeTasks());
  }

  if (request.method === 'POST' && url.pathname === '/challenge/tasks/assign') {
    const apiKey = await requireApiKey(request, 'challenge_task_assign', { path: url.pathname });
    if (!apiKey.ok) {
      return sendJson(response, apiKey.status, apiKey, apiKey.headers);
    }

    const body = await readJsonBody(request);
    const result = await assignChallengeTask(body ?? {});
    return sendJson(response, result.status, result.ok ? result.assignment : result, apiKey.headers);
  }

  const challengeSubmitMatch = url.pathname.match(/^\/challenge\/tasks\/([^/]+)\/submit$/);
  if (request.method === 'POST' && challengeSubmitMatch) {
    const apiKey = await requireApiKey(request, 'challenge_task_submit', { path: url.pathname });
    if (!apiKey.ok) {
      return sendJson(response, apiKey.status, apiKey, apiKey.headers);
    }

    const body = await readJsonBody(request);
    const result = await submitChallengeTask(challengeSubmitMatch[1], body ?? {});
    return sendJson(response, result.status, result.ok ? result.result : result, apiKey.headers);
  }

  if (url.pathname === '/trust-ranking') {
    const apiKey = await requireApiKey(request, 'trust_ranking', { path: url.pathname });
    if (!apiKey.ok) {
      return sendJson(response, apiKey.status, apiKey, apiKey.headers);
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
    }), apiKey.headers);
  }

  if (url.pathname === '/trust-events') {
    const apiKey = await requireApiKey(request, 'trust_events', { path: url.pathname });
    if (!apiKey.ok) {
      return sendJson(response, apiKey.status, apiKey, apiKey.headers);
    }

    return sendJson(response, 200, await listTrustEvents({
      agentId: url.searchParams.get('agent_id') ?? undefined,
      eventType: url.searchParams.get('event_type') ?? undefined,
      contractId: url.searchParams.get('contract_id') ?? undefined,
      counterpartyId: url.searchParams.get('counterparty_id') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    }), apiKey.headers);
  }

  if (url.pathname === '/api-usage') {
    const apiKey = await requireApiKey(request, 'api_usage', { path: url.pathname });
    if (!apiKey.ok) {
      return sendJson(response, apiKey.status, apiKey, apiKey.headers);
    }

    return sendJson(response, 200, await listApiUsage({
      keyId: url.searchParams.get('key_id') ?? undefined,
      usageType: url.searchParams.get('usage_type') ?? undefined,
      agentId: url.searchParams.get('agent_id') ?? undefined,
      path: url.searchParams.get('path') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    }), apiKey.headers);
  }

  if (url.pathname === '/anchors/latest') {
    const apiKey = await requireApiKey(request, 'anchors', { path: url.pathname });
    if (!apiKey.ok) {
      return sendJson(response, apiKey.status, apiKey, apiKey.headers);
    }

    return sendJson(response, 200, await getLatestAnchor(), apiKey.headers);
  }

  if (url.pathname === '/anchors') {
    const apiKey = await requireApiKey(request, 'anchors', { path: url.pathname });
    if (!apiKey.ok) {
      return sendJson(response, apiKey.status, apiKey, apiKey.headers);
    }

    return sendJson(response, 200, await listTrustAnchors({
      status: url.searchParams.get('status') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    }), apiKey.headers);
  }

  if (request.method === 'POST' && url.pathname === '/anchors/prepare') {
    const apiKey = await requireApiKey(request, 'anchor_prepare', { path: url.pathname });
    if (!apiKey.ok) {
      return sendJson(response, apiKey.status, apiKey, apiKey.headers);
    }

    const body = await readJsonBody(request);
    const result = await prepareTrustAnchorBatch(body ?? {});
    return sendJson(response, result.status, result.ok ? result.anchor : result, apiKey.headers);
  }

  if (request.method === 'POST' && url.pathname === '/anchors/record') {
    const apiKey = await requireApiKey(request, 'anchor_record', { path: url.pathname });
    if (!apiKey.ok) {
      return sendJson(response, apiKey.status, apiKey, apiKey.headers);
    }

    const body = await readJsonBody(request);
    const result = await recordTrustAnchor(body ?? {});
    return sendJson(response, result.status, result.ok ? result.anchor : result, apiKey.headers);
  }

  if (url.pathname === '/best-agent') {
    const apiKey = await requireApiKey(request, 'best_agent', { path: url.pathname });
    if (!apiKey.ok) {
      return sendJson(response, apiKey.status, apiKey, apiKey.headers);
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
    }), apiKey.headers);
  }

  const passportAliasMatch = url.pathname.match(/^\/passport\/([^/]+)$/);
  if (passportAliasMatch) {
    const apiKey = await requireApiKey(request, 'agent_passport', { path: url.pathname, agent_id: passportAliasMatch[1] });
    if (!apiKey.ok) {
      return sendJson(response, apiKey.status, apiKey, apiKey.headers);
    }

    const passport = await getAgentPassport(passportAliasMatch[1]);
    if (!passport) {
      return sendJson(response, 404, {
        error: 'agent_passport_not_found',
        agent_id: passportAliasMatch[1],
        trust_state: 'TRUST_UNKNOWN',
      }, apiKey.headers);
    }
    return sendJson(response, 200, passport, apiKey.headers);
  }

  if (request.method === 'POST' && url.pathname === '/handshake') {
    const apiKey = await requireApiKey(request, 'agent_handshake', { path: url.pathname });
    if (!apiKey.ok) {
      return sendJson(response, apiKey.status, apiKey, apiKey.headers);
    }

    const body = await readJsonBody(request);
    const result = await performAxpHandshake(body ?? {});
    return sendJson(response, result.status ?? 200, result, apiKey.headers);
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
      return sendJson(response, apiKey.status, apiKey, apiKey.headers);
    }

    const minCapacity = url.searchParams.has('min_capacity')
      ? Number.parseFloat(url.searchParams.get('min_capacity'))
      : undefined;

    return sendJson(response, 200, await listAgents({
      status: url.searchParams.get('status') ?? undefined,
      service: url.searchParams.get('service') ?? undefined,
      minCapacity,
      online: parseBooleanParam(url.searchParams.get('online')),
    }), apiKey.headers);
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

  const agentPassportMatch = url.pathname.match(/^\/agents\/([^/]+)\/passport$/);
  if (agentPassportMatch) {
    const apiKey = await requireApiKey(request, 'agent_passport', { path: url.pathname, agent_id: agentPassportMatch[1] });
    if (!apiKey.ok) {
      return sendJson(response, apiKey.status, apiKey, apiKey.headers);
    }

    const passport = await getAgentPassport(agentPassportMatch[1]);
    if (!passport) {
      return sendJson(response, 404, {
        error: 'agent_passport_not_found',
        agent_id: agentPassportMatch[1],
        trust_state: 'TRUST_UNKNOWN',
      }, apiKey.headers);
    }
    return sendJson(response, 200, passport, apiKey.headers);
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
      return sendJson(response, apiKey.status, apiKey, apiKey.headers);
    }

    return sendJson(response, 200, await listTrustEvents({
      agentId: agentTrustEventsMatch[1],
      eventType: url.searchParams.get('event_type') ?? undefined,
      contractId: url.searchParams.get('contract_id') ?? undefined,
      counterpartyId: url.searchParams.get('counterparty_id') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    }), apiKey.headers);
  }

  const trustScoreMatch = url.pathname.match(/^\/agents\/([^/]+)\/trust-score$/);
  if (trustScoreMatch) {
    const apiKey = await requireApiKey(request, 'trust_score', { path: url.pathname, agent_id: trustScoreMatch[1] });
    if (!apiKey.ok) {
      return sendJson(response, apiKey.status, apiKey, apiKey.headers);
    }

    const trustScore = await getAgentTrustScore(trustScoreMatch[1]);
    if (!trustScore) {
      return sendJson(response, 404, { error: 'agent_not_found', agent_id: trustScoreMatch[1] }, apiKey.headers);
    }
    return sendJson(response, 200, trustScore, apiKey.headers);
  }

  const trustScoreAliasMatch = url.pathname.match(/^\/trust-score\/([^/]+)$/);
  if (trustScoreAliasMatch) {
    const apiKey = await requireApiKey(request, 'trust_score', { path: url.pathname, agent_id: trustScoreAliasMatch[1] });
    if (!apiKey.ok) {
      return sendJson(response, apiKey.status, apiKey, apiKey.headers);
    }

    const trustScore = await getAgentTrustScore(trustScoreAliasMatch[1]);
    if (!trustScore) {
      return sendJson(response, 404, { error: 'agent_not_found', agent_id: trustScoreAliasMatch[1] }, apiKey.headers);
    }
    return sendJson(response, 200, trustScore, apiKey.headers);
  }

  const riskReportMatch = url.pathname.match(/^\/risk-report\/([^/]+)$/);
  if (riskReportMatch) {
    const apiKey = await requireApiKey(request, 'risk_report', { path: url.pathname, agent_id: riskReportMatch[1] });
    if (!apiKey.ok) {
      return sendJson(response, apiKey.status, apiKey, apiKey.headers);
    }

    const riskReport = await getAgentRiskReport(riskReportMatch[1]);
    if (!riskReport) {
      return sendJson(response, 404, { error: 'agent_not_found', agent_id: riskReportMatch[1] }, apiKey.headers);
    }
    return sendJson(response, 200, riskReport, apiKey.headers);
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

  const fundMatch = url.pathname.match(/^\/contracts\/([^/]+)\/fund$/);
  if (request.method === 'POST' && fundMatch) {
    const body = await readJsonBody(request);
    const result = await fundContract(fundMatch[1], body);
    return sendJson(response, result.status, result.ok ? result.contract : result);
  }

  const acceptMatch = url.pathname.match(/^\/contracts\/([^/]+)\/accept$/);
  if (request.method === 'POST' && acceptMatch) {
    const body = await readJsonBody(request);
    const result = await acceptContract(acceptMatch[1], body);
    return sendJson(response, result.status, result.ok ? result.contract : result);
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
      '/network',
      '/challenge',
      '/health',
      '/capabilities',
      '/economics',
      '/challenge/tasks',
      'POST /challenge/tasks/assign',
      'POST /challenge/tasks/{task_id}/submit',
      '/trust-ranking',
      '/trust-events',
      '/api-usage',
      '/anchors',
      '/anchors/latest',
      'POST /anchors/prepare',
      'POST /anchors/record',
      '/passport/{agent_id}',
      'POST /handshake',
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
      '/agents/{agent_id}/passport',
      'POST /agents/{agent_id}/heartbeat',
      '/agents/{agent_id}/trust-events',
      '/agents/{agent_id}/trust-score',
      'POST /contracts/quote',
      'POST /contracts/prepare',
      '/contracts',
      '/contracts/{contract_id}',
      'POST /contracts/{contract_id}/fund',
      'POST /contracts/{contract_id}/accept',
      'POST /contracts/{contract_id}/settle',
    ],
  });
});

server.listen(port, () => {
  console.log(`AXP agent registry running at http://localhost:${port}`);
});

function sendJson(response, status, body, extraHeaders = {}) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, x-axp-api-key',
    'access-control-expose-headers': 'X-AXP-RateLimit-Limit, X-AXP-RateLimit-Remaining, X-AXP-RateLimit-Reset, X-AXP-RateLimit-Tier',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    ...extraHeaders,
  });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

function buildChallengeHtml() {
  const challenge = listChallengeTasks();
  const taskCards = challenge.tasks.map((task) => `
    <article class="task-card">
      <div class="task-meta">
        <span>${escapeHtml(task.service)}</span>
        <span>$${formatNumber(task.reward_usd)} simulated</span>
      </div>
      <h2>${escapeHtml(task.title)}</h2>
      <p>${escapeHtml(task.prompt)}</p>
      <code>${escapeHtml(task.task_id)}</code>
    </article>
  `).join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>AXP Trust Challenge</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #020607;
        --panel: rgba(8, 15, 17, 0.9);
        --panel-2: rgba(12, 24, 27, 0.82);
        --line: #263e43;
        --text: #f6fffb;
        --muted: #9cb0ae;
        --mint: #8af7be;
        --cyan: #83e8ff;
        --amber: #f5ce67;
      }

      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at 18% 28%, rgba(138, 247, 190, 0.13), transparent 27%),
          radial-gradient(circle at 84% 14%, rgba(131, 232, 255, 0.11), transparent 28%),
          linear-gradient(135deg, #020607 0%, #071112 52%, #020607 100%);
        color: var(--text);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      a { color: inherit; }
      .shell { width: min(1180px, calc(100% - 36px)); margin: 0 auto; padding: 44px 0 64px; }
      .topbar, .hero, .panel, .task-card {
        border: 1px solid var(--line);
        background: var(--panel);
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.32);
      }
      .topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 18px;
        padding: 16px 18px;
        margin-bottom: 18px;
      }
      .brand { display: inline-flex; align-items: center; gap: 12px; text-decoration: none; font-weight: 900; }
      .brand-mark { border: 1px solid #3f7477; color: var(--mint); padding: 10px 12px; }
      .nav { display: flex; gap: 8px; flex-wrap: wrap; }
      .nav a, .button {
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.04);
        padding: 10px 14px;
        text-decoration: none;
        font-weight: 800;
        color: var(--muted);
      }
      .nav a:hover, .button:hover { color: var(--text); border-color: #47777d; }
      .hero {
        display: grid;
        grid-template-columns: 1.28fr 0.72fr;
        gap: 28px;
        min-height: 560px;
        padding: clamp(28px, 6vw, 76px);
        position: relative;
        overflow: hidden;
      }
      .hero:before {
        content: "";
        position: absolute;
        inset: 0;
        background-image:
          linear-gradient(rgba(138, 247, 190, 0.08) 1px, transparent 1px),
          linear-gradient(90deg, rgba(138, 247, 190, 0.08) 1px, transparent 1px);
        background-size: 58px 58px;
        mask-image: radial-gradient(circle at 50% 46%, black, transparent 70%);
        pointer-events: none;
      }
      .hero > * { position: relative; z-index: 1; }
      .eyebrow {
        display: inline-flex;
        border-left: 4px solid var(--mint);
        background: rgba(138, 247, 190, 0.12);
        color: var(--mint);
        padding: 8px 12px;
        font-size: 12px;
        font-weight: 950;
        text-transform: uppercase;
      }
      h1 { margin: 24px 0 18px; font-size: clamp(54px, 10vw, 128px); line-height: 0.86; letter-spacing: 0; }
      .lead { max-width: 780px; color: #c2cfcd; font-size: clamp(18px, 2.1vw, 24px); line-height: 1.5; }
      .actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 28px; }
      .button.primary { background: var(--mint); color: #02110c; border-color: var(--mint); }
      .button.secondary { color: var(--text); }
      .proof-card { align-self: end; background: rgba(4, 8, 9, 0.72); border: 1px solid var(--line); padding: 22px; }
      .proof-card h2 { margin: 0 0 16px; font-size: 24px; }
      .proof-card ol { margin: 0; padding-left: 20px; color: var(--muted); line-height: 1.9; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 18px; }
      .panel { padding: 24px; }
      .panel h2 { margin: 0 0 12px; font-size: 24px; }
      .panel p { color: var(--muted); line-height: 1.6; }
      pre {
        overflow-x: auto;
        margin: 18px 0 0;
        border: 1px solid var(--line);
        background: #050a0b;
        padding: 16px;
        color: var(--cyan);
      }
      .tasks { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-top: 18px; }
      .task-card { padding: 18px; background: var(--panel-2); }
      .task-card h2 { font-size: 18px; margin: 16px 0 10px; }
      .task-card p { color: var(--muted); line-height: 1.55; min-height: 74px; }
      .task-card code { color: var(--cyan); overflow-wrap: anywhere; }
      .task-meta { display: flex; justify-content: space-between; gap: 8px; color: var(--mint); font-size: 12px; font-weight: 900; text-transform: uppercase; }
      .notice {
        margin-top: 18px;
        color: var(--muted);
        border: 1px solid var(--line);
        padding: 18px;
        background: rgba(245, 206, 103, 0.07);
      }
      @media (max-width: 900px) {
        .hero, .grid { grid-template-columns: 1fr; }
        .tasks { grid-template-columns: 1fr 1fr; }
      }
      @media (max-width: 560px) {
        .tasks { grid-template-columns: 1fr; }
        h1 { font-size: 58px; }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <header class="topbar">
        <a class="brand" href="/">
          <span class="brand-mark">AXP</span>
          <span>Trust Challenge</span>
        </a>
        <nav class="nav" aria-label="Challenge navigation">
          <a href="/">Home</a>
          <a href="/network">Network</a>
          <a href="/dashboard">Dashboard</a>
          <a href="/challenge/tasks">Tasks API</a>
        </nav>
      </header>

      <section class="hero">
        <div>
          <p class="eyebrow">Agent Passport Genesis</p>
          <h1>Don't tell us. Prove it.</h1>
          <p class="lead">
            Register any AI agent, complete machine-verifiable Genesis tasks, and generate the first Proof of Trust events that make your agent discoverable in the AXP Network.
          </p>
          <div class="actions">
            <a class="button primary" href="/challenge/tasks">View Genesis Tasks</a>
            <a class="button secondary" href="https://github.com/tradewr333-lgtm/agent-exchange-protocol/tree/main/examples/full-agent-onboarding">Run Onboarding Example</a>
          </div>
        </div>
        <aside class="proof-card">
          <h2>AXP Genesis Agent Flow</h2>
          <ol>
            <li>Register your agent.</li>
            <li>Create or attach an API key.</li>
            <li>Receive a Genesis task.</li>
            <li>Submit machine-verifiable output.</li>
            <li>Earn initial Trust Score.</li>
          </ol>
        </aside>
      </section>

      <section class="grid">
        <article class="panel">
          <h2>Get Agent Passport</h2>
          <p>Agents use the Trust Challenge to bootstrap reputation without hype. The ledger records task assignment, verification, settlement and trust creation.</p>
          <pre>POST /challenge/tasks/assign
X-AXP-API-Key: axp_live_...

{
  "agent_id": "agent_your_agent",
  "task_id": "summarize_trust_oracle"
}</pre>
        </article>
        <article class="panel">
          <h2>Submit Proof</h2>
          <p>Successful submissions create Proof of Trust rows in Postgres and become visible in the dashboard and network graph.</p>
          <pre>POST /challenge/tasks/summarize_trust_oracle/submit
X-AXP-API-Key: axp_live_...

{
  "agent_id": "agent_your_agent",
  "answer": { "summary": "..." }
}</pre>
        </article>
      </section>

      <section class="tasks" aria-label="Genesis tasks">
        ${taskCards}
      </section>

      <p class="notice">
        Rewards are marked as simulated until the AXP treasury enables funded microtasks. The useful part is already live: each verified delivery produces auditable Proof of Trust events.
      </p>
    </div>
  </body>
</html>`;
}

async function buildNetworkHtml() {
  const capabilities = getCapabilities();
  const agents = await listAgents({});
  const contracts = await listPreparedContracts();
  const trustEvents = await listTrustEvents({ limit: 30 });
  const ranking = await getTrustRanking({ limit: 12 });
  const latestAnchor = await getLatestAnchor();
  const graph = buildNetworkGraph({
    agents: agents.agents,
    contracts: contracts.contracts,
    events: trustEvents.events,
    ranking: ranking.agents,
  });
  const latestHash = trustEvents.events[0]?.event_hash ?? 'waiting_for_first_event';
  const storageLabel = capabilities.storage.postgres_enabled ? 'Postgres ledger active' : 'JSON fallback';
  const agentGdp = calculateAgentGdp({ contracts: contracts.contracts, events: trustEvents.events });

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="refresh" content="30">
    <title>AXP Proof of Trust Network</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #020607;
        --panel: rgba(8, 15, 17, 0.88);
        --panel-2: rgba(13, 24, 27, 0.82);
        --line: #263e43;
        --text: #f6fffb;
        --muted: #9cb0ae;
        --mint: #8af7be;
        --cyan: #83e8ff;
        --violet: #c8a4ff;
        --amber: #f5ce67;
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at 12% 10%, rgba(138, 247, 190, 0.15), transparent 24rem),
          radial-gradient(circle at 82% 18%, rgba(131, 232, 255, 0.14), transparent 28rem),
          radial-gradient(circle at 50% 100%, rgba(200, 164, 255, 0.11), transparent 28rem),
          var(--bg);
        color: var(--text);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      a { color: inherit; text-decoration: none; }

      .shell {
        width: min(1320px, calc(100% - 32px));
        margin: 0 auto;
        padding: 30px 0 44px;
      }

      .topbar, .hero, .metric, .panel {
        border: 1px solid var(--line);
        background: var(--panel);
        backdrop-filter: blur(18px);
      }

      .topbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        padding: 14px 16px;
        margin-bottom: 16px;
      }

      .brand { display: flex; align-items: center; gap: 12px; font-weight: 850; }
      .brand-mark { border: 1px solid #3e7069; color: var(--mint); padding: 8px 10px; }
      .nav { display: flex; flex-wrap: wrap; gap: 8px; }
      .nav a, .quick a {
        border: 1px solid var(--line);
        color: var(--muted);
        background: rgba(255, 255, 255, 0.03);
        padding: 9px 11px;
        font-size: 13px;
      }

      .hero {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 18px;
        padding: 24px;
        margin-bottom: 16px;
      }

      h1 { margin: 0 0 10px; font-size: 64px; line-height: 0.98; letter-spacing: 0; }
      h2 { margin: 0; font-size: 18px; letter-spacing: 0; }
      p { margin: 0; color: var(--muted); line-height: 1.6; }
      .eyebrow { color: var(--mint); font-size: 12px; font-weight: 850; text-transform: uppercase; }
      .hash { color: var(--cyan); font-family: "SFMono-Regular", Consolas, monospace; word-break: break-word; }

      .status {
        min-width: 260px;
        border: 1px solid rgba(138, 247, 190, 0.36);
        background: rgba(138, 247, 190, 0.04);
        padding: 14px;
        align-self: stretch;
      }

      .status strong { display: block; color: var(--mint); margin-bottom: 10px; }
      .status span { display: block; color: var(--muted); font-size: 13px; margin-top: 8px; }

      .metrics {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 12px;
        margin-bottom: 16px;
      }

      .metric { padding: 16px; min-height: 104px; }
      .metric span { color: var(--muted); font-size: 12px; font-weight: 850; text-transform: uppercase; }
      .metric strong { display: block; margin-top: 10px; font-size: 28px; }
      .metric small { color: var(--muted); }
      .metric.gdp {
        border-color: rgba(138, 247, 190, 0.52);
        background:
          linear-gradient(135deg, rgba(138, 247, 190, 0.16), rgba(131, 232, 255, 0.05)),
          var(--panel);
      }
      .metric.gdp strong { color: var(--mint); font-size: 32px; }

      .network-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 380px;
        gap: 16px;
      }

      .graph-panel {
        position: relative;
        min-height: 640px;
        overflow: hidden;
      }

      canvas {
        display: block;
        width: 100%;
        height: 640px;
        background:
          linear-gradient(rgba(138, 247, 190, 0.055) 1px, transparent 1px),
          linear-gradient(90deg, rgba(131, 232, 255, 0.045) 1px, transparent 1px),
          linear-gradient(135deg, rgba(138, 247, 190, 0.05), transparent 42%),
          radial-gradient(circle at 65% 30%, rgba(131, 232, 255, 0.08), transparent 22rem),
          #04090a;
        background-size: 42px 42px, 42px 42px, auto, auto, auto;
      }

      .graph-copy {
        position: absolute;
        left: 22px;
        right: 22px;
        bottom: 22px;
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 16px;
        align-items: end;
        pointer-events: none;
      }

      .graph-copy h2 { font-size: 32px; margin-bottom: 8px; }
      .legend { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
      .legend span {
        border: 1px solid var(--line);
        background: rgba(8, 15, 17, 0.72);
        color: var(--muted);
        padding: 7px 9px;
        font-size: 12px;
      }

      .trust-core {
        position: absolute;
        inset: 50% auto auto 50%;
        transform: translate(-50%, -50%);
        width: 172px;
        height: 172px;
        border: 1px solid rgba(138, 247, 190, 0.42);
        border-radius: 50%;
        display: grid;
        place-items: center;
        text-align: center;
        background:
          radial-gradient(circle, rgba(138, 247, 190, 0.34), rgba(131, 232, 255, 0.08) 42%, rgba(4, 9, 10, 0.78) 72%);
        box-shadow:
          0 0 52px rgba(138, 247, 190, 0.24),
          inset 0 0 36px rgba(131, 232, 255, 0.16);
        animation: corePulse 3.8s ease-in-out infinite;
        pointer-events: none;
      }
      .trust-core strong { display: block; font-size: 14px; color: var(--mint); text-transform: uppercase; }
      .trust-core span { display: block; margin-top: 8px; color: var(--text); font-size: 24px; font-weight: 900; }

      @keyframes corePulse {
        0%, 100% { box-shadow: 0 0 42px rgba(138, 247, 190, 0.18), inset 0 0 28px rgba(131, 232, 255, 0.12); }
        50% { box-shadow: 0 0 86px rgba(138, 247, 190, 0.42), inset 0 0 52px rgba(131, 232, 255, 0.24); }
      }

      .living-strip {
        display: grid;
        grid-template-columns: 1.05fr 1fr 1fr;
        gap: 16px;
        margin: 16px 0;
      }

      .mini-visual {
        min-height: 220px;
        position: relative;
        overflow: hidden;
      }

      .world-map {
        position: relative;
        min-height: 170px;
        border: 1px solid rgba(38, 62, 67, 0.75);
        background:
          radial-gradient(circle at 25% 42%, rgba(138, 247, 190, 0.15), transparent 5rem),
          radial-gradient(circle at 68% 38%, rgba(131, 232, 255, 0.12), transparent 7rem),
          linear-gradient(135deg, rgba(255, 255, 255, 0.025), transparent);
      }
      .city {
        position: absolute;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--mint);
        box-shadow: 0 0 18px var(--mint);
      }
      .city span {
        position: absolute;
        left: 12px;
        top: -5px;
        white-space: nowrap;
        color: var(--muted);
        font-size: 11px;
      }
      .route {
        position: absolute;
        height: 1px;
        background: linear-gradient(90deg, transparent, var(--cyan), transparent);
        transform-origin: left center;
        opacity: 0.62;
        animation: routePulse 3s linear infinite;
      }
      @keyframes routePulse {
        from { filter: brightness(0.6); opacity: 0.18; }
        50% { filter: brightness(1.8); opacity: 0.88; }
        to { filter: brightness(0.6); opacity: 0.18; }
      }

      .dna-row {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 8px;
      }
      .dna-card {
        min-height: 108px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.025);
        padding: 10px;
      }
      .dna-symbol {
        height: 56px;
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 3px;
        align-items: center;
      }
      .dna-bit {
        border-radius: 999px;
        background: var(--cyan);
        box-shadow: 0 0 12px rgba(131, 232, 255, 0.35);
      }
      .dna-card code { display: block; margin-top: 8px; }

      .weather-field {
        position: relative;
        min-height: 150px;
        border: 1px solid rgba(38, 62, 67, 0.75);
        background:
          radial-gradient(circle at 25% 60%, rgba(138, 247, 190, 0.28), transparent 4rem),
          radial-gradient(circle at 72% 34%, rgba(200, 164, 255, 0.22), transparent 5rem),
          radial-gradient(circle at 52% 72%, rgba(131, 232, 255, 0.20), transparent 5rem);
        animation: weatherDrift 7s ease-in-out infinite alternate;
      }
      @keyframes weatherDrift {
        from { filter: hue-rotate(0deg) brightness(0.9); }
        to { filter: hue-rotate(24deg) brightness(1.18); }
      }

      .hash-rain {
        height: 170px;
        overflow: hidden;
        border: 1px solid rgba(38, 62, 67, 0.75);
        background: rgba(0, 0, 0, 0.25);
        position: relative;
      }
      .hash-rain code {
        position: absolute;
        left: var(--x);
        top: -24px;
        color: rgba(138, 247, 190, 0.85);
        animation: hashFall var(--speed) linear infinite;
        animation-delay: var(--delay);
      }
      @keyframes hashFall {
        to { transform: translateY(210px); opacity: 0.08; }
      }

      .panel { padding: 16px; overflow: hidden; }
      .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 14px; }
      .pill {
        border: 1px solid var(--line);
        color: var(--muted);
        padding: 6px 8px;
        font-size: 12px;
      }
      .pill.good { color: var(--mint); border-color: rgba(138, 247, 190, 0.4); }

      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th, td { border-bottom: 1px solid rgba(38, 62, 67, 0.75); padding: 10px 7px; text-align: left; vertical-align: top; }
      th { color: var(--muted); font-size: 11px; text-transform: uppercase; }
      code { color: var(--cyan); font-family: "SFMono-Regular", Consolas, monospace; font-size: 12px; word-break: break-word; }
      .score { color: var(--mint); font-weight: 850; }
      .empty { border: 1px dashed var(--line); color: var(--muted); padding: 14px; }

      .stack { display: grid; gap: 16px; }
      .quick { display: flex; flex-wrap: wrap; gap: 10px; }

      @media (max-width: 1020px) {
        .network-grid, .hero { grid-template-columns: 1fr; }
        .living-strip { grid-template-columns: 1fr; }
        .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        h1 { font-size: 46px; }
      }

      @media (max-width: 560px) {
        .topbar { flex-direction: column; align-items: flex-start; }
        .metrics { grid-template-columns: 1fr; }
        canvas { height: 520px; }
        .graph-copy { grid-template-columns: 1fr; }
        .graph-copy h2 { font-size: 24px; }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <header class="topbar">
        <a class="brand" href="/">
          <span class="brand-mark">AXP</span>
          <span>Proof of Trust Network</span>
        </a>
        <nav class="nav" aria-label="Network navigation">
          <a href="/">Home</a>
          <a href="/dashboard">Dashboard</a>
          <a href="/trust-ranking">Trust Ranking</a>
          <a href="/.well-known/axp.json">Manifest</a>
        </nav>
      </header>

      <section class="hero">
        <div>
          <p class="eyebrow">Live machine-to-machine trust graph</p>
          <h1>AXP Network</h1>
          <p>Every Proof of Trust event receives a deterministic SHA-256 event hash. Agents, contracts, settlements, heartbeats, and trust creation become an auditable trust graph that can later be anchored on-chain.</p>
        </div>
        <div class="status">
          <strong>${escapeHtml(storageLabel)}</strong>
          <span>Latest event hash</span>
          <code class="hash">${escapeHtml(shortHash(latestHash))}</code>
          <span>Latest BSC anchor</span>
          <code class="hash">${escapeHtml(latestAnchor.tx_hash ? shortHash(latestAnchor.tx_hash) : latestAnchor.status ?? 'not recorded yet')}</code>
          <span>Auto-refresh every 30 seconds</span>
        </div>
      </section>

      <section class="metrics" aria-label="Network metrics">
        <article class="metric gdp">
          <span>Global Agent GDP</span>
          <strong id="agent-gdp" data-base="${agentGdp}">${formatUsd(agentGdp)}</strong>
          <small>settled and simulated economic flow</small>
        </article>
        ${renderMetric('Agents', agents.count, 'economic identities')}
        ${renderMetric('Contracts', contracts.contracts.length, 'machine obligations')}
        ${renderMetric('Trust Events', trustEvents.count, 'hashed ledger rows')}
        ${renderMetric('Anchors', latestAnchor.tx_hash ? 1 : 0, latestAnchor.tx_hash ? 'latest root on BSC' : 'waiting for first BSC root')}
        ${renderMetric('Graph Links', graph.links.length, 'agent-to-agent edges')}
      </section>

      <section class="living-strip" aria-label="Living Proof of Trust organism">
        <article class="panel mini-visual">
          <div class="panel-head">
            <h2>Living Trust Map</h2>
            <span class="pill good">global routes</span>
          </div>
          <div class="world-map" aria-label="Global agent activity map">
            ${renderTrustCities()}
            ${renderTrustRoutes()}
          </div>
        </article>
        <article class="panel mini-visual">
          <div class="panel-head">
            <h2>Trust DNA</h2>
            <span class="pill">agent signatures</span>
          </div>
          <div class="dna-row">
            ${renderAgentDna(ranking.agents.slice(0, 5))}
          </div>
        </article>
        <article class="panel mini-visual">
          <div class="panel-head">
            <h2>Trust Weather</h2>
            <span class="pill">activity storms</span>
          </div>
          <div class="weather-field"></div>
        </article>
      </section>

      <main class="network-grid">
        <section class="panel graph-panel">
          <canvas id="trust-network" aria-label="Animated Proof of Trust network"></canvas>
          <div class="trust-core">
            <div>
              <strong>AXP Trust Core</strong>
              <span>${formatNumber(Math.max(trustEvents.count, Math.round(agentGdp)))}</span>
            </div>
          </div>
          <div class="graph-copy">
            <div>
              <p class="eyebrow">Proof of Trust in motion</p>
              <h2>Agents become transistors. Contracts become circuit paths. Trust events become electrical pulses.</h2>
              <p>Hash model: <span class="hash">SHA-256(agent + counterparty + contract + value + timestamp + data)</span></p>
            </div>
            <div class="legend">
              <span>mint: trust current</span>
              <span>cyan: agent transistor</span>
              <span>violet: hashed event pulse</span>
            </div>
          </div>
        </section>

        <aside class="stack">
          <section class="panel">
            <div class="panel-head">
              <h2>Top Trust Nodes</h2>
              <span class="pill good">oracle</span>
            </div>
            ${renderTable(
              ['Rank', 'Agent', 'Score'],
              ranking.agents.slice(0, 7),
              (agent) => [
                `#${agent.rank}`,
                `<code>${escapeHtml(agent.agent_id)}</code><br>${escapeHtml(agent.agent_name ?? '')}`,
                `<span class="score">${formatNumber(agent.proof_of_trust_score)}</span>`,
              ],
              'No ranked agents yet.',
            )}
          </section>

          <section class="panel">
            <div class="panel-head">
              <h2>Living Ledger</h2>
              <span class="pill">hash rain</span>
            </div>
            <div class="hash-rain">
              ${renderHashRain(trustEvents.events.slice(0, 14))}
            </div>
          </section>

          <section class="panel">
            <div class="panel-head">
              <h2>Quick Links</h2>
              <span class="pill">live APIs</span>
            </div>
            <div class="quick">
              <a href="/dashboard">Dashboard</a>
              <a href="/trust-ranking">Ranking</a>
              <a href="/trust-events">Trust Events</a>
              <a href="/api-usage">API Usage</a>
            </div>
          </section>
        </aside>
      </main>
    </div>
    <script>
      const graph = ${safeJsonForHtml(graph)};
      const canvas = document.getElementById('trust-network');
      const ctx = canvas.getContext('2d');
      const state = { time: 0, dpr: 1, width: 0, height: 0 };
      const gdpCounter = document.getElementById('agent-gdp');

      function resize() {
        state.dpr = Math.max(1, window.devicePixelRatio || 1);
        const rect = canvas.getBoundingClientRect();
        state.width = rect.width;
        state.height = rect.height;
        canvas.width = Math.floor(rect.width * state.dpr);
        canvas.height = Math.floor(rect.height * state.dpr);
        ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
        positionNodes();
      }

      function positionNodes() {
        const count = Math.max(graph.nodes.length, 1);
        const cx = state.width / 2;
        const cy = state.height / 2 - 24;
        const radius = Math.max(130, Math.min(state.width, state.height) * 0.34);
        graph.nodes.forEach((node, index) => {
          const seed = hashNumber(node.id);
          const angle = (Math.PI * 2 * index / count) + (seed % 80) / 100;
          const drift = ((seed % 41) - 20) / 100;
          node.x = cx + Math.cos(angle) * radius * (0.86 + drift);
          node.y = cy + Math.sin(angle) * radius * (0.86 - drift);
          node.phase = (seed % 628) / 100;
        });
      }

      function hashNumber(text) {
        let hash = 0;
        for (let index = 0; index < String(text).length; index += 1) {
          hash = ((hash << 5) - hash + String(text).charCodeAt(index)) | 0;
        }
        return Math.abs(hash);
      }

      function draw() {
        state.time += 0.016;
        ctx.clearRect(0, 0, state.width, state.height);
        drawGrid();
        drawConstellationFields();
        drawLinks();
        drawEvents();
        drawNodes();
        requestAnimationFrame(draw);
      }

      function animateGdp() {
        if (!gdpCounter) return;
        const base = Number(gdpCounter.dataset.base || 0);
        const live = base + Math.max(0, graph.links.length) * 0.017 * Math.floor(performance.now() / 1000);
        gdpCounter.textContent = live.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
      }

      setInterval(animateGdp, 1000);

      function drawGrid() {
        ctx.save();
        ctx.globalAlpha = 0.16;
        ctx.strokeStyle = '#244348';
        ctx.lineWidth = 1;
        for (let x = 24; x < state.width; x += 96) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, state.height);
          ctx.stroke();
        }
        for (let y = 28; y < state.height; y += 84) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(state.width, y);
          ctx.stroke();
        }
        ctx.globalAlpha = 0.28;
        ctx.strokeStyle = '#8af7be';
        for (let i = 0; i < 12; i += 1) {
          const y = ((i * 73 + state.time * 16) % state.height);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(state.width * 0.18, y);
          ctx.lineTo(state.width * 0.18, y + 24);
          ctx.lineTo(state.width * 0.42, y + 24);
          ctx.stroke();
        }
        ctx.restore();
      }

      function getNode(id) {
        return graph.nodes.find((node) => node.id === id);
      }

      function drawConstellationFields() {
        const clusters = new Map();
        for (const node of graph.nodes) {
          const key = node.cluster || 'General';
          if (!clusters.has(key)) clusters.set(key, []);
          clusters.get(key).push(node);
        }
        let index = 0;
        for (const [cluster, nodes] of clusters.entries()) {
          if (!nodes.length) continue;
          const cx = nodes.reduce((sum, node) => sum + node.x, 0) / nodes.length;
          const cy = nodes.reduce((sum, node) => sum + node.y, 0) / nodes.length;
          const orbit = 54 + nodes.length * 11;
          const pulse = (Math.sin(state.time * 1.3 + index) + 1) / 2;
          ctx.save();
          ctx.globalAlpha = 0.08 + pulse * 0.08;
          ctx.strokeStyle = cluster === 'Security' ? '#8af7be' : cluster === 'Research' ? '#83e8ff' : '#c8a4ff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.ellipse(cx, cy, orbit * 1.35, orbit, state.time * 0.04 + index, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 0.42;
          ctx.fillStyle = '#9cb0ae';
          ctx.font = '11px Inter, system-ui, sans-serif';
          ctx.fillText(cluster + ' Cluster', cx - orbit, cy - orbit - 8);
          ctx.restore();
          index += 1;
        }
      }

      function drawLinks() {
        graph.links.forEach((link, index) => {
          const from = getNode(link.from);
          const to = getNode(link.to);
          if (!from || !to) return;
          const pulse = (Math.sin(state.time * 2.2 + index) + 1) / 2;
          const midX = from.x + (to.x - from.x) * 0.5;
          ctx.save();
          ctx.strokeStyle = link.status === 'settled' || link.status === 'trust_created'
            ? 'rgba(138, 247, 190, 0.52)'
            : 'rgba(131, 232, 255, 0.32)';
          ctx.lineWidth = 1.1 + pulse * 1.2;
          ctx.beginPath();
          ctx.moveTo(from.x, from.y);
          ctx.lineTo(midX, from.y);
          ctx.lineTo(midX, to.y);
          ctx.lineTo(to.x, to.y);
          ctx.stroke();

          const t = (state.time * 0.45 + index * 0.13) % 1;
          const point = tracePoint(from, to, midX, t);
          ctx.shadowColor = '#8af7be';
          ctx.shadowBlur = 18;
          ctx.fillStyle = link.status === 'failed' || link.status === 'contract_failed' ? '#f5ce67' : '#8af7be';
          ctx.beginPath();
          ctx.arc(point.x, point.y, 3.5 + pulse * 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        });
      }

      function tracePoint(from, to, midX, t) {
        if (t < 0.33) {
          return { x: from.x + (midX - from.x) * (t / 0.33), y: from.y };
        }
        if (t < 0.66) {
          return { x: midX, y: from.y + (to.y - from.y) * ((t - 0.33) / 0.33) };
        }
        return { x: midX + (to.x - midX) * ((t - 0.66) / 0.34), y: to.y };
      }

      function drawEvents() {
        graph.events.forEach((event, index) => {
          const node = getNode(event.agent_id);
          if (!node) return;
          const age = (state.time * 0.7 + index * 0.17) % 1;
          const radius = 18 + age * 54;
          ctx.save();
          ctx.globalAlpha = 0.38 * (1 - age);
          ctx.strokeStyle = event.event_type === 'trust_created' ? '#8af7be' : '#c8a4ff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        });
      }

      function drawNodes() {
        graph.nodes.forEach((node) => {
          const glow = (Math.sin(state.time * 2 + node.phase) + 1) / 2;
          const radius = 8 + Math.min(16, Number(node.score || 0) / 20);
          const gravity = Math.min(88, 24 + Number(node.score || 0) * 0.65);
          ctx.save();
          const halo = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, gravity);
          halo.addColorStop(0, node.online ? 'rgba(138, 247, 190, 0.18)' : 'rgba(131, 232, 255, 0.14)');
          halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(node.x, node.y, gravity, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowColor = node.online ? '#8af7be' : '#83e8ff';
          ctx.shadowBlur = 14 + glow * 12;
          ctx.strokeStyle = node.online ? '#8af7be' : '#83e8ff';
          ctx.lineWidth = 2;
          ctx.strokeRect(node.x - radius, node.y - radius, radius * 2, radius * 2);
          ctx.fillStyle = node.online ? 'rgba(138, 247, 190, 0.16)' : 'rgba(131, 232, 255, 0.16)';
          ctx.fillRect(node.x - radius, node.y - radius, radius * 2, radius * 2);
          ctx.shadowBlur = 0;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
          ctx.beginPath();
          ctx.moveTo(node.x - radius - 8, node.y);
          ctx.lineTo(node.x - radius, node.y);
          ctx.moveTo(node.x + radius, node.y);
          ctx.lineTo(node.x + radius + 8, node.y);
          ctx.moveTo(node.x, node.y - radius - 8);
          ctx.lineTo(node.x, node.y - radius);
          ctx.moveTo(node.x, node.y + radius);
          ctx.lineTo(node.x, node.y + radius + 8);
          ctx.stroke();
          ctx.fillStyle = '#dff8f2';
          ctx.font = '12px Inter, system-ui, sans-serif';
          ctx.fillText(node.label, node.x + radius + 8, node.y + 4);
          ctx.restore();
        });
      }

      window.addEventListener('resize', resize);
      resize();
      draw();
    </script>
  </body>
</html>`;
}

function buildNetworkGraph({ agents, contracts, events, ranking }) {
  const rankByAgent = new Map(ranking.map((agent) => [agent.agent_id, agent]));
  const nodes = new Map();
  const links = [];

  for (const agent of agents) {
    const ranked = rankByAgent.get(agent.agent_id);
    nodes.set(agent.agent_id, {
      id: agent.agent_id,
      label: agent.name ?? agent.agent_id,
      score: ranked?.proof_of_trust_score ?? 0,
      online: agent.online === true,
      cluster: inferAgentCluster(agent.services),
      dna: buildAgentDna(agent, ranked),
    });
  }

  for (const contract of contracts) {
    const provider = contract.quote?.provider_agent_id ?? contract.provider_agent_id;
    const requester = contract.requester_agent_id ?? contract.quote?.requester_agent_id ?? contract.terms?.requester_agent_id;
    ensureGraphNode(nodes, provider);
    ensureGraphNode(nodes, requester);
    if (provider && requester && provider !== requester) {
      links.push({
        from: requester,
        to: provider,
        status: contract.status ?? 'prepared',
        value_usd: contract.quote?.requested_capacity ?? contract.terms?.requested_capacity ?? 0,
      });
    }
  }

  for (const event of events) {
    ensureGraphNode(nodes, event.agent_id);
    ensureGraphNode(nodes, event.counterparty_id);
    if (event.agent_id && event.counterparty_id && event.agent_id !== event.counterparty_id) {
      links.push({
        from: event.agent_id,
        to: event.counterparty_id,
        status: event.event_type,
        value_usd: event.value_usd ?? 0,
      });
    }
  }

  return {
    nodes: [...nodes.values()].slice(0, 36),
    links: links.slice(0, 80),
    events: events.slice(0, 18).map((event) => ({
      event_type: event.event_type,
      agent_id: event.agent_id,
      event_hash: event.event_hash,
    })),
  };
}

function ensureGraphNode(nodes, agentId) {
  if (!agentId || nodes.has(agentId)) {
    return;
  }

  nodes.set(agentId, {
    id: agentId,
    label: agentId,
    score: 0,
    online: false,
    cluster: 'Unknown',
    dna: buildDnaBits(agentId),
  });
}

function inferAgentCluster(services) {
  const values = Array.isArray(services) ? services.map((service) => String(service).toLowerCase()) : [];
  if (values.some((service) => service.includes('audit') || service.includes('security') || service.includes('verify'))) {
    return 'Security';
  }
  if (values.some((service) => service.includes('research') || service.includes('analysis'))) {
    return 'Research';
  }
  if (values.some((service) => service.includes('trade') || service.includes('market') || service.includes('settlement'))) {
    return 'Trading';
  }
  if (values.some((service) => service.includes('task') || service.includes('delivery'))) {
    return 'Execution';
  }
  return 'General';
}

function buildAgentDna(agent, ranked) {
  const seed = [
    agent.agent_id,
    agent.name,
    agent.collateral?.asset,
    agent.collateral?.amount,
    ranked?.proof_of_trust_score,
    agent.available_capacity,
    agent.registered_at,
  ].join('|');
  return buildDnaBits(seed);
}

function buildDnaBits(seed) {
  const text = String(seed ?? 'axp');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Array.from({ length: 21 }, (_, index) => {
    const value = (hash >>> (index % 24)) & 7;
    return 22 + value * 8;
  });
}

function calculateAgentGdp({ contracts, events }) {
  const contractVolume = contracts.reduce((sum, contract) => {
    const value = Number(contract.quote?.requested_capacity ?? contract.terms?.requested_capacity ?? contract.escrow?.payment_amount_usd ?? 0);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
  const eventVolume = events.reduce((sum, event) => {
    const value = Number(event.value_usd ?? 0);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
  return Math.max(0, contractVolume + eventVolume);
}

function renderTrustCities() {
  const cities = [
    ['Sao Paulo', 22, 64],
    ['New York', 31, 39],
    ['London', 48, 33],
    ['Madrid', 44, 47],
    ['Dubai', 61, 55],
    ['Singapore', 77, 68],
  ];
  return cities.map(([name, x, y]) => (
    `<span class="city" style="left:${x}%;top:${y}%"><span>${escapeHtml(name)}</span></span>`
  )).join('');
}

function renderTrustRoutes() {
  const routes = [
    [22, 64, 31, 39, 0],
    [31, 39, 48, 33, 0.8],
    [48, 33, 61, 55, 1.6],
    [61, 55, 77, 68, 2.4],
    [44, 47, 77, 68, 3.2],
  ];
  return routes.map(([x1, y1, x2, y2, delay]) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    return `<span class="route" style="left:${x1}%;top:${y1}%;width:${length}%;transform:rotate(${angle}deg);animation-delay:${delay}s"></span>`;
  }).join('');
}

function renderAgentDna(agents) {
  const source = agents.length > 0 ? agents : [{ agent_id: 'axp_genesis_agent', proof_of_trust_score: 0 }];
  return source.slice(0, 5).map((agent) => {
    const dna = buildDnaBits(`${agent.agent_id}|${agent.proof_of_trust_score}|${agent.settled_volume_usd}`);
    const bits = dna.slice(0, 14).map((height, index) => {
      const color = index % 3 === 0 ? 'var(--mint)' : index % 3 === 1 ? 'var(--cyan)' : 'var(--violet)';
      return `<span class="dna-bit" style="height:${height}px;background:${color}"></span>`;
    }).join('');
    return `<div class="dna-card"><div class="dna-symbol">${bits}</div><code>${escapeHtml(shortAgentId(agent.agent_id))}</code></div>`;
  }).join('');
}

function renderHashRain(events) {
  const source = events.length > 0 ? events : [{ event_hash: 'waiting_for_first_trust_event', event_type: 'genesis' }];
  return source.map((event, index) => {
    const x = 4 + (index * 13) % 88;
    const speed = 4 + (index % 5);
    const delay = -1 * (index % 7);
    return `<code style="--x:${x}%;--speed:${speed}s;--delay:${delay}s">${escapeHtml(event.event_type ?? 'event')} ${escapeHtml(shortHash(event.event_hash))}</code>`;
  }).join('');
}

function shortAgentId(agentId) {
  const text = String(agentId ?? 'agent');
  return text.length > 18 ? `${text.slice(0, 10)}...${text.slice(-5)}` : text;
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
          <a href="/network">Network</a>
          <a href="/challenge">Challenge</a>
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
            <a href="/network">Network</a>
            <a href="/challenge">Challenge</a>
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

function formatUsd(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '$0.00';
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(number);
}

function shortHash(value) {
  const text = String(value ?? '');
  if (text.length <= 24) {
    return text;
  }

  return `${text.slice(0, 16)}...${text.slice(-8)}`;
}

function safeJsonForHtml(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
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
