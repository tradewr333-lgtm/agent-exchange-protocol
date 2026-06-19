import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPreparedContract, prepareContract, quoteContract } from './src/contracts.js';
import { getAgent, getCapabilities, listAgents, readJsonFile } from './src/registry.js';

const port = Number.parseInt(process.env.PORT ?? '4180', 10);
const currentDir = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(currentDir, '..', '.well-known', 'axp.json');

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://localhost:${port}`);

  if (request.method === 'OPTIONS') {
    return sendJson(response, 204, {});
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

  if (url.pathname === '/agents') {
    const minCapacity = url.searchParams.has('min_capacity')
      ? Number.parseFloat(url.searchParams.get('min_capacity'))
      : undefined;

    return sendJson(response, 200, listAgents({
      status: url.searchParams.get('status') ?? undefined,
      service: url.searchParams.get('service') ?? undefined,
      minCapacity,
    }));
  }

  const agentMatch = url.pathname.match(/^\/agents\/([^/]+)$/);
  if (agentMatch) {
    const agent = getAgent(agentMatch[1]);
    if (!agent) {
      return sendJson(response, 404, { error: 'agent_not_found', agent_id: agentMatch[1] });
    }
    return sendJson(response, 200, agent);
  }

  if (request.method === 'POST' && url.pathname === '/contracts/quote') {
    const body = await readJsonBody(request);
    const result = quoteContract(body);
    return sendJson(response, result.status, result.ok ? result.quote : result);
  }

  if (request.method === 'POST' && url.pathname === '/contracts/prepare') {
    const body = await readJsonBody(request);
    const result = prepareContract(body);
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
      '/agents',
      '/agents/{agent_id}',
      'POST /contracts/quote',
      'POST /contracts/prepare',
      '/contracts/{contract_id}',
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
