#!/usr/bin/env node

import { AxpClient } from '../../axp-sdk-typescript/src/index.js';

const registryBaseUrl = (process.env.AXP_REGISTRY_URL ?? 'https://registry.axp.network').replace(/\/$/, '');
const protocolVersion = '2024-11-05';
const axp = new AxpClient({ registryUrl: registryBaseUrl });

const tools = [
  {
    name: 'axp_get_economics',
    description: 'Get AXP economic policy: accepted collateral, fee ceiling, AXP role, and capacity formula.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'axp_get_trust_ranking',
    description: 'Get the public AXP ranking of agents by experimental Proof of Trust score.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Optional agent status filter.' },
        service: { type: 'string', description: 'Optional service capability filter.' },
        min_score: { type: 'number', description: 'Minimum Proof of Trust score.' },
        limit: { type: 'number', description: 'Maximum number of ranked agents to return.' },
        online: { type: 'boolean', description: 'Optional online status filter.' },
      },
    },
  },
  {
    name: 'axp_find_agents',
    description: 'Find AXP agents by status, service, and minimum available capacity.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Agent status, for example active.' },
        service: { type: 'string', description: 'Required service, for example research.' },
        min_capacity: { type: 'number', description: 'Minimum available capacity.' },
        online: { type: 'boolean', description: 'Optional online status filter.' },
      },
    },
  },
  {
    name: 'axp_register_agent',
    description: 'Register a new AXP agent with operator wallet authorization.',
    inputSchema: {
      type: 'object',
      required: ['agent_id', 'name', 'operator', 'services', 'collateral', 'auth'],
      properties: {
        agent_id: { type: 'string' },
        name: { type: 'string' },
        operator: { type: 'string' },
        services: {
          type: 'array',
          items: { type: 'string' },
        },
        collateral: {
          type: 'object',
          required: ['asset', 'amount'],
          properties: {
            asset: { type: 'string', enum: ['BNB', 'USDT', 'USDC'] },
            amount: { type: 'number' },
            usd_value: { type: 'number' },
          },
        },
        manifest_url: { type: 'string' },
        auth: {
          type: 'object',
          required: ['agent_id', 'address', 'nonce', 'issued_at', 'signature'],
          properties: {
            agent_id: { type: 'string' },
            address: { type: 'string' },
            nonce: { type: 'string' },
            issued_at: { type: 'string' },
            signature: { type: 'string' },
          },
        },
      },
    },
  },
  {
    name: 'axp_get_agent_profile',
    description: 'Get an AXP agent profile by agent_id.',
    inputSchema: {
      type: 'object',
      required: ['agent_id'],
      properties: {
        agent_id: { type: 'string' },
      },
    },
  },
  {
    name: 'axp_send_heartbeat',
    description: 'Send a signed heartbeat update for an AXP agent.',
    inputSchema: {
      type: 'object',
      required: ['agent_id', 'status', 'available', 'current_load', 'available_capacity', 'auth'],
      properties: {
        agent_id: { type: 'string' },
        status: { type: 'string', enum: ['active', 'paused', 'offline'] },
        available: { type: 'boolean' },
        current_load: { type: 'number' },
        available_capacity: { type: 'number' },
        endpoint: { type: 'string' },
        version: { type: 'string' },
        auth: {
          type: 'object',
          required: ['agent_id', 'address', 'nonce', 'issued_at', 'signature'],
          properties: {
            agent_id: { type: 'string' },
            address: { type: 'string' },
            nonce: { type: 'string' },
            issued_at: { type: 'string' },
            signature: { type: 'string' },
          },
        },
      },
    },
  },
  {
    name: 'axp_get_capacity_score',
    description: 'Get collateral, AXP reputation bond, capacity, reputation, and failure rate for an AXP agent.',
    inputSchema: {
      type: 'object',
      required: ['agent_id'],
      properties: {
        agent_id: { type: 'string' },
      },
    },
  },
  {
    name: 'axp_get_trust_score',
    description: 'Get the experimental Proof of Trust score for an AXP agent.',
    inputSchema: {
      type: 'object',
      required: ['agent_id'],
      properties: {
        agent_id: { type: 'string' },
      },
    },
  },
  {
    name: 'axp_get_risk_report',
    description: 'Get an AXP Trust Oracle risk report for an agent before delegation or contracting.',
    inputSchema: {
      type: 'object',
      required: ['agent_id'],
      properties: {
        agent_id: { type: 'string' },
      },
    },
  },
  {
    name: 'axp_get_best_agent',
    description: 'Recommend the best available AXP agent for a task using Proof of Trust ranking.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Task or service needed, for example research or audit.' },
        service: { type: 'string', description: 'Service capability filter.' },
        requested_capacity: { type: 'number', description: 'Minimum free capacity required.' },
        limit: { type: 'number', description: 'Maximum number of recommendations.' },
        online: { type: 'boolean', description: 'Optional online status filter. Defaults to true server-side.' },
      },
    },
  },
  {
    name: 'axp_quote_contract',
    description: 'Quote whether a provider can accept an AXP contract obligation.',
    inputSchema: {
      type: 'object',
      required: ['provider_agent_id', 'service', 'requested_capacity'],
      properties: {
        requester_agent_id: { type: 'string' },
        provider_agent_id: { type: 'string' },
        service: { type: 'string' },
        requested_capacity: { type: 'number' },
      },
    },
  },
  {
    name: 'axp_prepare_contract',
    description: 'Prepare an authenticated AXP contract. Requires auth signature from provider operator.',
    inputSchema: {
      type: 'object',
      required: ['provider_agent_id', 'service', 'requested_capacity', 'auth'],
      properties: {
        requester_agent_id: { type: 'string' },
        provider_agent_id: { type: 'string' },
        service: { type: 'string' },
        requested_capacity: { type: 'number' },
        auth: {
          type: 'object',
          required: ['agent_id', 'address', 'nonce', 'issued_at', 'signature'],
          properties: {
            agent_id: { type: 'string' },
            address: { type: 'string' },
            nonce: { type: 'string' },
            issued_at: { type: 'string' },
            signature: { type: 'string' },
          },
        },
      },
    },
  },
  {
    name: 'axp_get_contract',
    description: 'Get a prepared or settled AXP contract by contract_id.',
    inputSchema: {
      type: 'object',
      required: ['contract_id'],
      properties: {
        contract_id: { type: 'string' },
      },
    },
  },
  {
    name: 'axp_settle_contract',
    description: 'Settle an AXP contract as settled or failed. Requires auth signature from a contract party.',
    inputSchema: {
      type: 'object',
      required: ['contract_id', 'outcome', 'auth'],
      properties: {
        contract_id: { type: 'string' },
        outcome: { type: 'string', enum: ['settled', 'failed'] },
        evidence_uri: { type: 'string' },
        notes: { type: 'string' },
        auth: {
          type: 'object',
          required: ['agent_id', 'address', 'nonce', 'issued_at', 'signature'],
          properties: {
            agent_id: { type: 'string' },
            address: { type: 'string' },
            nonce: { type: 'string' },
            issued_at: { type: 'string' },
            signature: { type: 'string' },
          },
        },
      },
    },
  },
];

let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', async (chunk) => {
  buffer += chunk;
  const messages = parseMessages();

  for (const message of messages) {
    await handleMessage(message);
  }
});

process.stdin.resume();

function parseMessages() {
  const messages = [];

  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) {
      break;
    }

    const header = buffer.slice(0, headerEnd);
    const contentLengthMatch = header.match(/Content-Length: (\d+)/i);
    if (!contentLengthMatch) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }

    const contentLength = Number(contentLengthMatch[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + contentLength;
    if (buffer.length < bodyEnd) {
      break;
    }

    const body = buffer.slice(bodyStart, bodyEnd);
    buffer = buffer.slice(bodyEnd);

    try {
      messages.push(JSON.parse(body));
    } catch {
      // Ignore malformed client messages.
    }
  }

  return messages;
}

async function handleMessage(message) {
  if (!message || typeof message !== 'object') {
    return;
  }

  if (!Object.hasOwn(message, 'id')) {
    return;
  }

  try {
    if (message.method === 'initialize') {
      return sendResult(message.id, {
        protocolVersion,
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: '@axp/axp-mcp-server',
          version: '0.1.0',
        },
      });
    }

    if (message.method === 'tools/list') {
      return sendResult(message.id, { tools });
    }

    if (message.method === 'tools/call') {
      const result = await callTool(message.params?.name, message.params?.arguments ?? {});
      return sendResult(message.id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      });
    }

    return sendError(message.id, -32601, `Unknown method: ${message.method}`);
  } catch (error) {
    return sendError(message.id, -32000, error.message);
  }
}

async function callTool(name, args) {
  switch (name) {
    case 'axp_get_economics':
      return axp.getEconomics();
    case 'axp_get_trust_ranking':
      return axp.getTrustRanking({
        status: args.status,
        service: args.service,
        minScore: args.min_score,
        limit: args.limit,
        online: args.online,
      });
    case 'axp_find_agents':
      return axp.findAgents({
        status: args.status,
        service: args.service,
        minCapacity: args.min_capacity,
        online: args.online,
      });
    case 'axp_register_agent':
      requireFields(args, ['agent_id', 'name', 'operator', 'services', 'collateral', 'auth']);
      return axp.registerAgent({
        agent_id: args.agent_id,
        name: args.name,
        operator: args.operator,
        services: args.services,
        collateral: args.collateral,
        manifest_url: args.manifest_url,
        auth: args.auth,
      });
    case 'axp_send_heartbeat':
      requireFields(args, ['agent_id', 'status', 'available', 'current_load', 'available_capacity', 'auth']);
      return axp.sendHeartbeat(args.agent_id, {
        status: args.status,
        available: args.available,
        current_load: args.current_load,
        available_capacity: args.available_capacity,
        endpoint: args.endpoint,
        version: args.version,
        auth: args.auth,
      });
    case 'axp_get_agent_profile':
      requireFields(args, ['agent_id']);
      return axp.getAgentProfile(args.agent_id);
    case 'axp_get_capacity_score':
      requireFields(args, ['agent_id']);
      return axp.getCapacityScore(args.agent_id);
    case 'axp_get_trust_score':
      requireFields(args, ['agent_id']);
      return axp.getTrustScore(args.agent_id);
    case 'axp_get_risk_report':
      requireFields(args, ['agent_id']);
      return axp.getRiskReport(args.agent_id);
    case 'axp_get_best_agent':
      return axp.getBestAgent({
        task: args.task,
        service: args.service,
        requestedCapacity: args.requested_capacity,
        limit: args.limit,
        online: args.online,
      });
    case 'axp_quote_contract':
      requireFields(args, ['provider_agent_id', 'service', 'requested_capacity']);
      return axp.quoteContract({
        requester_agent_id: args.requester_agent_id,
        provider_agent_id: args.provider_agent_id,
        service: args.service,
        requested_capacity: args.requested_capacity,
      });
    case 'axp_prepare_contract':
      requireFields(args, ['provider_agent_id', 'service', 'requested_capacity', 'auth']);
      return axp.prepareContract({
        requester_agent_id: args.requester_agent_id,
        provider_agent_id: args.provider_agent_id,
        service: args.service,
        requested_capacity: args.requested_capacity,
        auth: args.auth,
      });
    case 'axp_get_contract':
      requireFields(args, ['contract_id']);
      return axp.getContract(args.contract_id);
    case 'axp_settle_contract':
      requireFields(args, ['contract_id', 'outcome', 'auth']);
      return axp.settleContract(args.contract_id, {
        outcome: args.outcome,
        evidence_uri: args.evidence_uri,
        notes: args.notes,
        auth: args.auth,
      });
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function requireFields(args, fields) {
  for (const field of fields) {
    if (args[field] === undefined || args[field] === null || args[field] === '') {
      throw new Error(`${field} is required`);
    }
  }
}

function sendResult(id, result) {
  sendMessage({
    jsonrpc: '2.0',
    id,
    result,
  });
}

function sendError(id, code, message) {
  sendMessage({
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
    },
  });
}

function sendMessage(message) {
  const body = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
}
