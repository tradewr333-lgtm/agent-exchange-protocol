#!/usr/bin/env node

import { AxpClient } from '../../axp-sdk-typescript/src/index.js';

const registryBaseUrl = (process.env.AXP_REGISTRY_URL ?? 'https://registry.axp.network').replace(/\/$/, '');
const protocolVersion = '2024-11-05';
const axp = new AxpClient({ registryUrl: registryBaseUrl });

const tools = [
  {
    name: 'axp_find_agents',
    description: 'Find AXP agents by status, service, and minimum available capacity.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Agent status, for example active.' },
        service: { type: 'string', description: 'Required service, for example research.' },
        min_capacity: { type: 'number', description: 'Minimum available capacity.' },
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
    name: 'axp_get_capacity_score',
    description: 'Get capacity, stake, reputation, and failure rate for an AXP agent.',
    inputSchema: {
      type: 'object',
      required: ['agent_id'],
      properties: {
        agent_id: { type: 'string' },
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
    case 'axp_find_agents':
      return axp.findAgents({
        status: args.status,
        service: args.service,
        minCapacity: args.min_capacity,
      });
    case 'axp_get_agent_profile':
      requireFields(args, ['agent_id']);
      return axp.getAgentProfile(args.agent_id);
    case 'axp_get_capacity_score':
      requireFields(args, ['agent_id']);
      return axp.getCapacityScore(args.agent_id);
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
