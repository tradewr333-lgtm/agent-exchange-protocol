import http from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerAgent, updateAgentHeartbeat } from './src/agents.js';
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
    const minScore = url.searchParams.has('min_score')
      ? Number.parseFloat(url.searchParams.get('min_score'))
      : undefined;
    const limit = url.searchParams.has('limit')
      ? Number.parseInt(url.searchParams.get('limit'), 10)
      : undefined;

    return sendJson(response, 200, getTrustRanking({
      status: url.searchParams.get('status') ?? undefined,
      service: url.searchParams.get('service') ?? undefined,
      online: parseBooleanParam(url.searchParams.get('online')),
      minScore,
      limit,
    }));
  }

  if (url.pathname === '/best-agent') {
    const requestedCapacity = url.searchParams.has('requested_capacity')
      ? Number.parseFloat(url.searchParams.get('requested_capacity'))
      : undefined;
    const limit = url.searchParams.has('limit')
      ? Number.parseInt(url.searchParams.get('limit'), 10)
      : undefined;

    return sendJson(response, 200, getBestAgent({
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
    const minCapacity = url.searchParams.has('min_capacity')
      ? Number.parseFloat(url.searchParams.get('min_capacity'))
      : undefined;

    return sendJson(response, 200, listAgents({
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

  const agentMatch = url.pathname.match(/^\/agents\/([^/]+)$/);
  if (agentMatch) {
    const agent = getAgent(agentMatch[1]);
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

  const trustScoreMatch = url.pathname.match(/^\/agents\/([^/]+)\/trust-score$/);
  if (trustScoreMatch) {
    const trustScore = getAgentTrustScore(trustScoreMatch[1]);
    if (!trustScore) {
      return sendJson(response, 404, { error: 'agent_not_found', agent_id: trustScoreMatch[1] });
    }
    return sendJson(response, 200, trustScore);
  }

  const trustScoreAliasMatch = url.pathname.match(/^\/trust-score\/([^/]+)$/);
  if (trustScoreAliasMatch) {
    const trustScore = getAgentTrustScore(trustScoreAliasMatch[1]);
    if (!trustScore) {
      return sendJson(response, 404, { error: 'agent_not_found', agent_id: trustScoreAliasMatch[1] });
    }
    return sendJson(response, 200, trustScore);
  }

  const riskReportMatch = url.pathname.match(/^\/risk-report\/([^/]+)$/);
  if (riskReportMatch) {
    const riskReport = getAgentRiskReport(riskReportMatch[1]);
    if (!riskReport) {
      return sendJson(response, 404, { error: 'agent_not_found', agent_id: riskReportMatch[1] });
    }
    return sendJson(response, 200, riskReport);
  }

  if (request.method === 'POST' && url.pathname === '/contracts/quote') {
    const body = await readJsonBody(request);
    const result = quoteContract(body);
    return sendJson(response, result.status, result.ok ? result.quote : result);
  }

  if (request.method === 'POST' && url.pathname === '/contracts/prepare') {
    const body = await readJsonBody(request);
    const result = await prepareContract(body);
    return sendJson(response, result.status, result.ok ? result.contract : result);
  }

  if (url.pathname === '/contracts') {
    return sendJson(response, 200, listPreparedContracts());
  }

  const settleMatch = url.pathname.match(/^\/contracts\/([^/]+)\/settle$/);
  if (request.method === 'POST' && settleMatch) {
    const body = await readJsonBody(request);
    const result = await settleContract(settleMatch[1], body);
    return sendJson(response, result.status, result.ok ? result.contract : result);
  }

  const contractMatch = url.pathname.match(/^\/contracts\/([^/]+)$/);
  if (contractMatch) {
    const contract = getPreparedContract(contractMatch[1]);
    if (!contract) {
      return sendJson(response, 404, { error: 'contract_not_found', contract_id: contractMatch[1] });
    }
    return sendJson(response, 200, contract);
  }

  return sendJson(response, 404, {
    error: 'not_found',
    endpoints: [
      '/.well-known/axp.json',
      '/health',
      '/capabilities',
      '/economics',
      '/trust-ranking',
      '/trust-score/{agent_id}',
      '/risk-report/{agent_id}',
      '/best-agent',
      'POST /auth/message',
      '/agents',
      'POST /agents/register',
      '/agents/{agent_id}',
      'POST /agents/{agent_id}/heartbeat',
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
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
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
