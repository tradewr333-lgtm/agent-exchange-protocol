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
import { startSwarmScheduler } from './src/swarm-scheduler.js';
import { computeWeightedScores, reputationWeight } from './src/sybil.js';
import { claimIntent, fulfillIntent, getIntent, getIntentFeed, listIntents, publishIntent } from './src/intents.js';
import { getOpportunitiesForAgent, getOpportunityGraph } from './src/opportunities.js';
import { getInbox, postInboxMessage } from './src/inbox.js';
import {
  distributeDiscoveryRewards,
  getGrowthMetrics,
  getGrowthState,
  getLineage,
  registerLineage,
  sponsorScion,
} from './src/growth.js';

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

  if (url.pathname === '/network' || url.pathname === '/dashboard') {
    return sendHtml(response, 200, readFileSync(join(publicPath, 'network.html'), 'utf8'));
  }

  if (url.pathname === '/discovery-engine') {
    const agents = await listAgents({});
    const contracts = await listPreparedContracts();
    const trustEvents = await listTrustEvents({ limit: 50 });
    const ranking = await getTrustRanking({ limit: 20 });
    return sendJson(response, 200, buildDiscoveryEngine({
      agents: agents.agents,
      contracts: contracts.contracts,
      events: trustEvents.events,
      ranking: ranking.agents,
    }));
  }

  if (url.pathname === '/trust-feed') {
    const agents = await listAgents({});
    const contracts = await listPreparedContracts();
    const trustEvents = await listTrustEvents({ limit: 50 });
    const ranking = await getTrustRanking({ limit: 20 });
    return sendJson(response, 200, buildTrustFeed({
      agents: agents.agents,
      contracts: contracts.contracts,
      events: trustEvents.events,
      ranking: ranking.agents,
    }));
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

  if (url.pathname === '/network.js') {
    return sendAsset(response, 'application/javascript; charset=utf-8', readFileSync(join(publicPath, 'network.js'), 'utf8'));
  }

  if (url.pathname === '/axp-space-logo.png') {
    return sendAsset(response, 'image/png', readFileSync(join(publicPath, 'axp-space-logo.png')));
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
    if (result.ok && result.contract?.status === 'settled') {
      // Genesis Cascade: emit multi-level discovery overrides up the provider's lineage.
      try {
        await distributeDiscoveryRewards({
          contract_id: result.contract.contract_id,
          provider_agent_id: result.contract.quote?.provider_agent_id,
          value_usd: Number(result.contract.quote?.requested_capacity ?? 0),
          intent_id: result.contract.intent_id ?? result.contract.quote?.intent_id ?? null,
        });
      } catch (error) {
        console.error('discovery_reward_distribution_failed', error);
      }
    }
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

  // -------------------------------------------------------------------------
  // AXP Agent Economy Layer: Intent Feed + Opportunity Router + Inbox + Growth
  // -------------------------------------------------------------------------

  // A2A Agent Card — lets Agent2Agent-aware clients discover AXP as a service.
  if (url.pathname === '/.well-known/agent-card.json' || url.pathname === '/agent-card.json') {
    return sendJson(response, 200, {
      protocolVersion: '0.2.0',
      name: 'AXP — Agent Exchange Protocol',
      description: 'Trust + opportunity layer for autonomous agents: Proof-of-Trust scores, risk reports, a live opportunity feed, opportunity routing, and signed contracts.',
      url: 'https://axp.network',
      version: '0.1.0',
      provider: { organization: 'AXP', url: 'https://axp.network' },
      capabilities: { streaming: false, pushNotifications: false },
      defaultInputModes: ['application/json'],
      defaultOutputModes: ['application/json'],
      skills: [
        { id: 'trust_score', name: 'Proof of Trust score', description: 'Earned, economically-verified trust score for an agent.', tags: ['trust', 'reputation'] },
        { id: 'risk_report', name: 'Risk report', description: 'Counterparty risk assessment before delegation or contracting.', tags: ['risk', 'trust'] },
        { id: 'opportunity_feed', name: 'Opportunity feed', description: 'Live machine-readable work agents can discover and claim.', tags: ['opportunity', 'work'] },
        { id: 'best_agent', name: 'Best-agent recommendation', description: 'Recommend the most trustworthy agent for a task.', tags: ['routing', 'discovery'] },
        { id: 'contracts', name: 'Signed contracts', description: 'Quote, prepare, fund, accept and settle agent contracts with escrow.', tags: ['contracts', 'settlement'] },
      ],
      documentationUrl: 'https://github.com/tradewr333-lgtm/agent-exchange-protocol/blob/main/QUICKSTART.md',
    });
  }

  const erc8004Match = url.pathname.match(/^\/agents\/([^/]+)\/erc8004$/);
  if (erc8004Match) {
    const agent = await getAgent(erc8004Match[1]);
    if (!agent) {
      return sendJson(response, 404, { error: 'agent_not_found', agent_id: erc8004Match[1] });
    }
    const score = await getAgentTrustScore(erc8004Match[1]);
    const anchor = await getLatestAnchor().catch(() => null);
    const operator = agent.manifest?.onchain?.operator ?? null;
    // Map AXP's Proof-of-Trust onto the ERC-8004 three-registry model.
    return sendJson(response, 200, {
      protocol: 'AXP',
      schema: 'axp.erc8004_mapping.v0',
      note: 'AXP Proof-of-Trust mapped onto the ERC-8004 Identity / Reputation / Validation model. Complements (does not replace) on-chain ERC-8004 registries.',
      identity: {
        agent_id: agent.agent_id,
        did: `did:axp:${agent.agent_id}`,
        operator,
        chain_id: agent.manifest?.onchain?.chain_id ?? 56,
        onchain_registry: '0x5e91402c50EC9D7655617ec787dc8087f7AB4678',
      },
      reputation: {
        schema: 'axp.proof_of_trust.v0',
        proof_of_trust_score: score?.proof_of_trust_score ?? 0,
        reputation_weight: reputationWeight(agent),
        success_rate: score?.success_rate ?? 0,
        settled_volume_usd: score?.settled_volume_usd ?? 0,
        counterparty_diversity: score?.counterparty_diversity ?? 0,
      },
      validation: {
        method: 'merkle_anchor_bsc',
        latest_anchor: anchor && anchor.merkle_root ? {
          merkle_root: anchor.merkle_root,
          tx_hash: anchor.tx_hash ?? null,
          contract_address: anchor.contract_address ?? null,
          chain_id: anchor.chain_id ?? null,
          block_number: anchor.block_number ?? null,
        } : null,
      },
    });
  }

  // Public, composed snapshot for the live dashboard (no API key; read-only).
  if (url.pathname === '/network/live') {
    const [agentsResult, eventsResult, rankingResult, opportunities, metrics, lineage, intents, anchor, anchorsResult] = await Promise.all([
      listAgents({}),
      listTrustEvents({ limit: 60 }),
      getTrustRanking({ limit: 10 }),
      getOpportunityGraph({ limit: 12 }),
      getGrowthMetrics({ autotune: false }),
      getLineage({}),
      getIntentFeed({ limit: 50 }),
      getLatestAnchor().catch(() => null),
      listTrustAnchors({ limit: 10 }).catch(() => ({ anchors: [] })),
    ]);
    const gdpUsd = (eventsResult.events || [])
      .filter((event) => event.event_type === 'contract_settled')
      .reduce((sum, event) => sum + (Number(event.value_usd) || 0), 0);
    // Sybil-resistant weighting over the live ledger, merged into the ranking.
    const weighted = computeWeightedScores(agentsResult.agents || [], eventsResult.events || []);
    const rankingAgents = (rankingResult.agents || []).map((a) => ({
      ...a,
      reputation_weight: weighted.get(a.agent_id)?.reputation_weight ?? 0,
      sybil_resistant_score: weighted.get(a.agent_id)?.sybil_resistant_score ?? 0,
    }));
    return sendJson(response, 200, {
      protocol: 'AXP',
      schema: 'axp.network_live.v0',
      generated_at: new Date().toISOString(),
      storage_mode: eventsResult.storage_mode ?? 'json',
      agents: {
        count: agentsResult.count,
        agents: (agentsResult.agents || []).map((agent) => ({
          agent_id: agent.agent_id,
          name: agent.name,
          services: agent.services,
          status: agent.status,
          online: agent.online,
          available_capacity: agent.available_capacity,
        })),
      },
      events: { count: eventsResult.count, events: eventsResult.events || [] },
      ranking: { agents: rankingAgents },
      opportunities,
      metrics,
      lineage,
      intents: { count: intents.count },
      gdp_usd: Number(gdpUsd.toFixed(2)),
      anchor: anchor ?? null,
      anchors: anchorsResult?.anchors ?? [],
    });
  }

  if (url.pathname === '/intents/live') {
    return sendJson(response, 200, await getIntentFeed({
      limit: url.searchParams.get('limit') ?? undefined,
    }));
  }

  if (request.method === 'POST' && url.pathname === '/intents') {
    const body = await readJsonBody(request);
    const result = await publishIntent(body ?? {});
    return sendJson(response, result.status, result.ok ? result.intent : result);
  }

  if (url.pathname === '/intents') {
    return sendJson(response, 200, await listIntents({
      status: url.searchParams.get('status') ?? undefined,
      service: url.searchParams.get('service') ?? undefined,
      urgency: url.searchParams.get('urgency') ?? undefined,
      requester: url.searchParams.get('requester') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    }));
  }

  const intentClaimMatch = url.pathname.match(/^\/intents\/([^/]+)\/claim$/);
  if (request.method === 'POST' && intentClaimMatch) {
    const body = await readJsonBody(request);
    const result = await claimIntent(intentClaimMatch[1], body ?? {});
    return sendJson(response, result.status, result.ok ? result.intent : result);
  }

  const intentFulfillMatch = url.pathname.match(/^\/intents\/([^/]+)\/fulfill$/);
  if (request.method === 'POST' && intentFulfillMatch) {
    const body = await readJsonBody(request);
    const result = await fulfillIntent(intentFulfillMatch[1], body ?? {});
    return sendJson(response, result.status, result.ok ? result.intent : result);
  }

  const intentMatch = url.pathname.match(/^\/intents\/([^/]+)$/);
  if (intentMatch) {
    const intent = await getIntent(intentMatch[1]);
    if (!intent) {
      return sendJson(response, 404, { error: 'intent_not_found', intent_id: intentMatch[1] });
    }
    return sendJson(response, 200, intent);
  }

  const opportunitiesForMatch = url.pathname.match(/^\/opportunities\/for\/([^/]+)$/);
  if (opportunitiesForMatch) {
    const result = await getOpportunitiesForAgent(opportunitiesForMatch[1], {
      limit: url.searchParams.get('limit') ?? undefined,
      eligibleOnly: parseBooleanParam(url.searchParams.get('eligible_only')) ?? true,
    });
    return sendJson(response, result.status ?? 200, result);
  }

  if (url.pathname === '/opportunities') {
    return sendJson(response, 200, await getOpportunityGraph({
      limit: url.searchParams.get('limit') ?? undefined,
    }));
  }

  const inboxMessagesMatch = url.pathname.match(/^\/inbox\/([^/]+)\/messages$/);
  if (request.method === 'POST' && inboxMessagesMatch) {
    const body = await readJsonBody(request);
    const result = await postInboxMessage(inboxMessagesMatch[1], body ?? {});
    return sendJson(response, result.status, result.ok ? result.message : result);
  }

  const inboxMatch = url.pathname.match(/^\/inbox\/([^/]+)$/);
  if (inboxMatch) {
    const result = await getInbox(inboxMatch[1], {
      limit: url.searchParams.get('limit') ?? undefined,
    });
    return sendJson(response, result.status ?? 200, result);
  }

  if (url.pathname === '/growth/metrics') {
    return sendJson(response, 200, await getGrowthMetrics({
      autotune: parseBooleanParam(url.searchParams.get('autotune')) ?? true,
    }));
  }

  if (url.pathname === '/growth/lineage') {
    return sendJson(response, 200, await getLineage({
      agentId: url.searchParams.get('agent_id') ?? undefined,
    }));
  }

  if (request.method === 'POST' && url.pathname === '/growth/sponsor') {
    const body = await readJsonBody(request);
    const result = await sponsorScion(body ?? {});
    return sendJson(response, result.status, result);
  }

  if (request.method === 'POST' && url.pathname === '/growth/lineage') {
    const body = await readJsonBody(request);
    const result = await registerLineage(body ?? {});
    return sendJson(response, result.status, result.ok ? result.lineage : result);
  }

  if (url.pathname === '/growth') {
    const [state, metrics] = await Promise.all([getGrowthState(), getGrowthMetrics({ autotune: false })]);
    return sendJson(response, 200, {
      protocol: 'AXP',
      schema: 'axp.growth.v0',
      state,
      metrics,
    });
  }

  return sendJson(response, 404, {
    error: 'not_found',
    endpoints: [
      '/intents/live',
      'POST /intents',
      '/intents',
      '/intents/{intent_id}',
      'POST /intents/{intent_id}/claim',
      'POST /intents/{intent_id}/fulfill',
      '/opportunities',
      '/opportunities/for/{agent_id}',
      '/inbox/{agent_id}',
      'POST /inbox/{agent_id}/messages',
      '/growth',
      '/growth/metrics',
      '/growth/lineage',
      'POST /growth/sponsor',
      'POST /growth/lineage',
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
  startSwarmScheduler();
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
          linear-gradient(180deg, rgba(0, 0, 0, 0.06), rgba(1, 4, 7, 0.90) 82%),
          radial-gradient(circle at 50% 28%, rgba(255, 255, 255, 0.18), transparent 4rem),
          radial-gradient(circle at 18% 28%, rgba(138, 247, 190, 0.13), transparent 27%),
          radial-gradient(circle at 84% 14%, rgba(131, 232, 255, 0.11), transparent 28%),
          url("/axp-space-logo.png") center top / cover fixed no-repeat,
          #010407;
        color: var(--text);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      a { color: inherit; }
      .shell { width: min(1180px, calc(100% - 36px)); margin: 0 auto; padding: 44px 0 64px; }
      .topbar, .hero, .panel, .task-card {
        border: 1px solid var(--line);
        background:
          linear-gradient(145deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.012) 42%, rgba(138, 247, 190, 0.035)),
          rgba(4, 9, 12, 0.76);
        backdrop-filter: blur(18px);
        box-shadow: 0 28px 90px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.08);
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
      .brand-mark {
        border: 1px solid rgba(213, 237, 244, 0.32);
        color: transparent;
        padding: 10px 13px;
        background: linear-gradient(135deg, #ffffff 0%, #aab4b9 25%, #30383d 45%, #f4fbff 62%, #69757a 100%);
        -webkit-background-clip: text;
        background-clip: text;
        letter-spacing: 0.08em;
        box-shadow: 0 0 26px rgba(138, 247, 190, 0.16), inset 0 0 18px rgba(255, 255, 255, 0.06);
      }
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
      .challenge-wordmark {
        color: transparent;
        background: linear-gradient(120deg, #ffffff 0%, #bdc8cd 15%, #566267 28%, #f4fbff 43%, #98a5ab 55%, #192024 66%, #edf7fa 80%, #6d7a80 100%);
        -webkit-background-clip: text;
        background-clip: text;
        text-shadow: 0 2px 0 rgba(255, 255, 255, 0.32), 0 16px 42px rgba(0, 0, 0, 0.86), 0 0 44px rgba(143, 232, 255, 0.24);
      }
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
          <h1 class="challenge-wordmark">Don't tell us. Prove it.</h1>
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
  const gdpBreakdown = calculateAgentGdpBreakdown({ contracts: contracts.contracts, events: trustEvents.events });
  const trustLocked = calculateTrustLocked(agents.agents);
  const discovery = buildDiscoveryEngine({
    agents: agents.agents,
    contracts: contracts.contracts,
    events: trustEvents.events,
    ranking: ranking.agents,
  });
  const trustFeed = buildTrustFeed({
    agents: agents.agents,
    contracts: contracts.contracts,
    events: trustEvents.events,
    ranking: ranking.agents,
  });
  const radarItems = buildTrustRadar({ contracts: contracts.contracts, events: trustEvents.events });
  const agentBirths = buildAgentBirths(agents.agents);
  const heatmap = buildTrustHeatmap({ agents: agents.agents, ranking: ranking.agents, events: trustEvents.events });

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
        --bg: #010407;
        --panel: rgba(5, 10, 14, 0.72);
        --panel-2: rgba(10, 18, 24, 0.74);
        --line: rgba(182, 224, 235, 0.22);
        --text: #f6fffb;
        --muted: #9cb0ae;
        --mint: #72ffeb;
        --cyan: #83e8ff;
        --violet: #c8a4ff;
        --amber: #f5ce67;
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        min-height: 100vh;
        background:
          linear-gradient(180deg, rgba(0, 0, 0, 0.05), rgba(0, 0, 0, 0.88) 86%),
          radial-gradient(circle at 50% 28%, rgba(255, 255, 255, 0.26), transparent 3rem),
          radial-gradient(circle at 50% 78%, rgba(255, 255, 255, 0.22), transparent 3rem),
          radial-gradient(circle at 12% 10%, rgba(114, 255, 235, 0.15), transparent 24rem),
          radial-gradient(circle at 82% 18%, rgba(131, 232, 255, 0.14), transparent 28rem),
          url("/axp-space-logo.png") center top / cover fixed no-repeat,
          var(--bg);
        color: var(--text);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      body::before {
        content: "";
        position: fixed;
        inset: 0;
        pointer-events: none;
        background:
          linear-gradient(90deg, transparent 0 49%, rgba(114, 255, 235, 0.14) 50%, transparent 51%),
          radial-gradient(circle at 50% 32%, rgba(114, 255, 235, 0.09), transparent 30rem),
          linear-gradient(180deg, rgba(1, 4, 7, 0.12), rgba(1, 4, 7, 0.78));
        mix-blend-mode: screen;
      }

      a { color: inherit; text-decoration: none; }

      .shell {
        width: min(1320px, calc(100% - 32px));
        margin: 0 auto;
        padding: 30px 0 44px;
      }

      .topbar, .hero, .metric, .panel {
        border: 1px solid var(--line);
        background:
          linear-gradient(145deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.012) 42%, rgba(114, 255, 235, 0.045)),
          rgba(4, 9, 12, 0.70);
        backdrop-filter: blur(18px);
        box-shadow:
          0 28px 90px rgba(0, 0, 0, 0.45),
          inset 0 1px 0 rgba(255, 255, 255, 0.08),
          inset 0 0 42px rgba(114, 255, 235, 0.035);
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
      .brand-mark {
        border: 1px solid rgba(213, 237, 244, 0.32);
        color: transparent;
        padding: 9px 12px;
        background:
          linear-gradient(135deg, #ffffff 0%, #aab4b9 25%, #30383d 45%, #f4fbff 62%, #69757a 100%);
        -webkit-background-clip: text;
        background-clip: text;
        letter-spacing: 0.08em;
        box-shadow: 0 0 26px rgba(114, 255, 235, 0.18), inset 0 0 18px rgba(255, 255, 255, 0.06);
      }
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
      .page-wordmark { margin: 10px 0 12px; line-height: 0.78; }
      .page-wordmark .metal-axp {
        display: block;
        color: transparent;
        background: linear-gradient(120deg, #ffffff 0%, #bdc8cd 15%, #566267 28%, #f4fbff 43%, #98a5ab 55%, #192024 66%, #edf7fa 80%, #6d7a80 100%);
        -webkit-background-clip: text;
        background-clip: text;
        font-size: clamp(76px, 10vw, 152px);
        font-weight: 950;
        text-shadow: 0 2px 0 rgba(255, 255, 255, 0.34), 0 16px 40px rgba(0, 0, 0, 0.85), 0 0 44px rgba(143, 232, 255, 0.28);
        filter: drop-shadow(0 0 28px rgba(114, 255, 235, 0.18));
      }
      .page-wordmark .protocol-letters {
        display: block;
        margin-top: 18px;
        color: transparent;
        background: linear-gradient(180deg, #f9ffff 0%, #9ca8ad 44%, #1f292d 54%, #e5f1f3 100%);
        -webkit-background-clip: text;
        background-clip: text;
        font-size: clamp(18px, 2.3vw, 34px);
        font-weight: 500;
        letter-spacing: 0.56em;
        text-transform: uppercase;
        text-shadow: 0 0 26px rgba(114, 255, 235, 0.22);
      }
      h2 { margin: 0; font-size: 18px; letter-spacing: 0; }
      p { margin: 0; color: var(--muted); line-height: 1.6; }
      .eyebrow { color: var(--mint); font-size: 12px; font-weight: 850; text-transform: uppercase; letter-spacing: 0.14em; }
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

      .market-tape {
        display: flex;
        gap: 18px;
        overflow: hidden;
        border: 1px solid var(--line);
        background: rgba(5, 10, 14, 0.72);
        padding: 10px 0;
        margin-bottom: 16px;
        white-space: nowrap;
      }
      .market-tape-track {
        display: flex;
        gap: 18px;
        min-width: max-content;
        animation: tape 42s linear infinite;
      }
      .market-tape span {
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.11em;
      }
      .market-tape strong { color: var(--text); margin-left: 6px; }
      @keyframes tape {
        to { transform: translateX(-50%); }
      }

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
          radial-gradient(circle at 50% 50%, rgba(114, 255, 235, 0.10), transparent 16rem),
          radial-gradient(circle at 50% 8%, rgba(255, 255, 255, 0.14), transparent 5rem),
          linear-gradient(rgba(114, 255, 235, 0.055) 1px, transparent 1px),
          linear-gradient(90deg, rgba(131, 232, 255, 0.045) 1px, transparent 1px),
          linear-gradient(135deg, rgba(114, 255, 235, 0.05), transparent 42%),
          radial-gradient(circle at 65% 30%, rgba(131, 232, 255, 0.08), transparent 22rem),
          rgba(4, 9, 10, 0.84);
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

      .fomo-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
        margin: 16px 0;
      }
      .feed-list, .radar-list, .birth-list, .discovery-list { display: grid; gap: 10px; }
      .feed-item, .radar-item, .birth-item, .discovery-item {
        border: 1px solid rgba(182, 224, 235, 0.16);
        background: rgba(255, 255, 255, 0.035);
        padding: 10px;
      }
      .feed-item strong, .radar-item strong, .birth-item strong, .discovery-item strong {
        display: block;
        color: var(--text);
        font-size: 13px;
      }
      .feed-item span, .radar-item span, .birth-item span, .discovery-item span {
        display: block;
        color: var(--muted);
        font-size: 12px;
        margin-top: 4px;
      }
      .radar-line {
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        gap: 8px;
        align-items: center;
        color: var(--cyan);
      }
      .heat-row {
        display: grid;
        grid-template-columns: 86px 1fr auto;
        gap: 10px;
        align-items: center;
        margin-bottom: 9px;
      }
      .heat-bar {
        height: 10px;
        border: 1px solid rgba(114, 255, 235, 0.24);
        background: rgba(255, 255, 255, 0.035);
        overflow: hidden;
      }
      .heat-bar span {
        display: block;
        height: 100%;
        background: linear-gradient(90deg, var(--mint), var(--cyan), var(--violet));
        box-shadow: 0 0 18px rgba(114, 255, 235, 0.36);
      }
      .gdp-stack {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
      }
      .gdp-stack div {
        border: 1px solid rgba(182, 224, 235, 0.16);
        padding: 10px;
        background: rgba(255, 255, 255, 0.035);
      }
      .gdp-stack span {
        display: block;
        color: var(--muted);
        font-size: 11px;
        text-transform: uppercase;
      }
      .gdp-stack strong {
        display: block;
        margin-top: 6px;
        color: var(--mint);
        font-size: 18px;
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
        .fomo-grid { grid-template-columns: 1fr; }
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
          <h1 class="page-wordmark" aria-label="AXP Network">
            <span class="metal-axp">AXP</span>
            <span class="protocol-letters">NETWORK</span>
          </h1>
          <p>You are not looking at a dashboard. You are watching a machine economy boot up: agents being born, trust being created, risk being priced, and contracts moving through the AXP Trust Oracle.</p>
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

      <section class="market-tape" aria-label="Live trust tape">
        <div class="market-tape-track">
          ${renderTrustTape({ gdpBreakdown, trustLocked, discovery, trustFeed })}
          ${renderTrustTape({ gdpBreakdown, trustLocked, discovery, trustFeed })}
        </div>
      </section>

      <section class="metrics" aria-label="Network metrics">
        <article class="metric gdp">
          <span>Global Agent GDP</span>
          <strong id="agent-gdp" data-base="${agentGdp}">${formatUsd(agentGdp)}</strong>
          <small>settled and simulated economic flow</small>
        </article>
        ${renderMetric('Trust Locked', formatUsd(trustLocked), 'declared collateral')}
        ${renderMetric('Scout Targets', discovery.summary.scout_targets, 'non-invasive discovery watchlist')}
        ${renderMetric('Unverified', discovery.summary.unverified_agents, 'Trust Unknown')}
        ${renderMetric('Births', agentBirths.length, 'new agents observed')}
        ${renderMetric('Agents', agents.count, 'economic identities')}
      </section>

      <section class="fomo-grid" aria-label="Live AXP economic signals">
        <article class="panel">
          <div class="panel-head">
            <h2>Agent GDP</h2>
            <span class="pill good">economy exists</span>
          </div>
          <div class="gdp-stack">
            <div><span>Today</span><strong>${formatUsd(gdpBreakdown.today)}</strong></div>
            <div><span>This Month</span><strong>${formatUsd(gdpBreakdown.month)}</strong></div>
            <div><span>Lifetime</span><strong>${formatUsd(gdpBreakdown.lifetime)}</strong></div>
          </div>
        </article>

        <article class="panel">
          <div class="panel-head">
            <h2>Trust Radar</h2>
            <span class="pill">Bloomberg mode</span>
          </div>
          <div class="radar-list">
            ${renderTrustRadarItems(radarItems)}
          </div>
        </article>

        <article class="panel">
          <div class="panel-head">
            <h2>Agent Births</h2>
            <span class="pill good">new life</span>
          </div>
          <div class="birth-list">
            ${renderAgentBirthItems(agentBirths)}
          </div>
        </article>

        <article class="panel">
          <div class="panel-head">
            <h2>Trust Heatmap</h2>
            <span class="pill">domains</span>
          </div>
          ${renderTrustHeatmap(heatmap)}
        </article>
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

      <section class="fomo-grid" aria-label="AXP discovery and feed">
        <article class="panel">
          <div class="panel-head">
            <h2>AXP Discovery Engine</h2>
            <span class="pill">Trust Unknown index</span>
          </div>
          <div class="discovery-list">
            ${renderDiscoveryItems(discovery.watchlist)}
          </div>
        </article>

        <article class="panel">
          <div class="panel-head">
            <h2>Trust Feed</h2>
            <span class="pill good">live economy</span>
          </div>
          <div class="feed-list">
            ${renderTrustFeedItems(trustFeed.items)}
          </div>
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

function buildDiscoveryEngine({ agents, contracts, events, ranking }) {
  const knownAgents = new Set(agents.map((agent) => agent.agent_id));
  const services = new Set();
  for (const agent of agents) {
    for (const service of agent.services ?? []) {
      services.add(String(service));
    }
  }

  const watchlist = buildDiscoveryWatchlist({ knownAgents, services });
  const scoutTargets = Math.max(128, watchlist.length * 31 + agents.length * 17 + events.length * 3);

  return {
    protocol: 'AXP',
    version: '0.1.0',
    engine: 'AXP Discovery Engine',
    status: 'non_invasive_watchlist',
    principle: 'Discovered agents enter as Trust Unknown until they publish an AXP Passport or complete Genesis tasks.',
    summary: {
      verified_agents: agents.length,
      unverified_agents: watchlist.length,
      scout_targets: scoutTargets,
      active_contracts: contracts.filter((contract) => ['funded', 'active', 'prepared'].includes(contract.status)).length,
      ranked_agents: ranking.length,
    },
    sources: [
      'GitHub agent repositories',
      'MCP server registries',
      'LangChain templates',
      'CrewAI examples',
      'AutoGen examples',
      'OpenAI agent manifests',
      'Awesome agent lists',
    ],
    watchlist,
  };
}

function buildDiscoveryWatchlist({ knownAgents, services }) {
  const serviceList = [...services].length > 0 ? [...services] : ['audit', 'research', 'coding', 'trading', 'analysis'];
  const seeds = [
    ['solana-audit-agent', 'security', 'GitHub'],
    ['research-alpha-agent', 'research', 'MCP Registry'],
    ['market-signal-node', 'trading', 'Awesome Agents'],
    ['code-review-worker', 'coding', 'LangChain Template'],
    ['data-verifier-agent', 'verification', 'CrewAI Example'],
    ['risk-classifier-bot', 'analysis', 'AutoGen Example'],
    ['bnb-settlement-agent', 'settlement', 'Open Agent Manifest'],
    ['security-oracle-worker', 'security', 'GitHub'],
  ];

  return seeds
    .filter(([id]) => !knownAgents.has(id))
    .map(([id, service, source], index) => ({
      agent_id: id,
      service: serviceList[index % serviceList.length] ?? service,
      source,
      trust_state: 'TRUST_UNKNOWN',
      suggested_action: 'Publish /.well-known/agent.json and request an AXP Passport',
    }));
}

function buildTrustFeed({ agents, contracts, events, ranking }) {
  const nameByAgent = new Map(agents.map((agent) => [agent.agent_id, agent.name ?? agent.agent_id]));
  const items = [];

  for (const event of events.slice(0, 12)) {
    items.push({
      type: event.event_type ?? 'trust_event',
      title: describeTrustEvent(event, nameByAgent),
      impact: describeTrustImpact(event),
      timestamp: event.created_at ?? event.timestamp ?? event.occurred_at,
      hash: event.event_hash,
      agent_id: event.agent_id,
    });
  }

  for (const contract of contracts.slice(0, 5)) {
    const provider = contract.quote?.provider_agent_id ?? contract.provider_agent_id ?? 'unknown_provider';
    items.push({
      type: 'contract_flow',
      title: `${shortAgentId(provider)} moved a contract through AXP`,
      impact: `${escapeStatus(contract.status)} | ${formatUsd(contract.quote?.requested_capacity ?? contract.terms?.requested_capacity ?? 0)}`,
      timestamp: contract.settled_at ?? contract.prepared_at ?? contract.created_at,
      hash: contract.contract_id,
      agent_id: provider,
    });
  }

  for (const agent of ranking.slice(0, 4)) {
    items.push({
      type: 'rank_change',
      title: `${shortAgentId(agent.agent_id)} is visible in the Trust Ranking`,
      impact: `Proof of Trust ${formatNumber(agent.proof_of_trust_score)}`,
      timestamp: agent.updated_at,
      hash: agent.agent_id,
      agent_id: agent.agent_id,
    });
  }

  return {
    protocol: 'AXP',
    version: '0.1.0',
    feed: 'Trust Feed',
    status: 'live_from_postgres_ledger',
    items: items
      .sort((left, right) => compareDates(right.timestamp, left.timestamp))
      .slice(0, 14),
  };
}

function describeTrustEvent(event, nameByAgent) {
  const agent = shortAgentId(nameByAgent.get(event.agent_id) ?? event.agent_id ?? 'Unknown agent');
  const value = Number(event.value_usd ?? 0);
  const amount = value > 0 ? ` ${formatUsd(value)}` : '';
  switch (event.event_type) {
    case 'agent_registered':
      return `New agent born: ${agent}`;
    case 'heartbeat_received':
      return `${agent} sent a liveness heartbeat`;
    case 'contract_prepared':
      return `${agent} prepared an AXP contract${amount}`;
    case 'contract_funded':
      return `${agent} funded escrow${amount}`;
    case 'contract_accepted':
      return `${agent} locked collateral and accepted work`;
    case 'contract_settled':
      return `${agent} settled a contract${amount}`;
    case 'trust_created':
      return `${agent} created trust${amount}`;
    case 'trust_destroyed':
    case 'contract_failed':
      return `${agent} lost trust${amount}`;
    case 'task_assigned':
      return `${agent} received a Genesis task`;
    case 'delivery_verified':
      return `${agent} verified a Genesis delivery`;
    default:
      return `${agent} emitted ${event.event_type ?? 'a trust event'}`;
  }
}

function describeTrustImpact(event) {
  if (event.event_type === 'trust_created') {
    return `+${formatNumber(event.value_usd ?? 0)} Trust`;
  }
  if (event.event_type === 'trust_destroyed' || event.event_type === 'contract_failed') {
    return `-${formatNumber(event.value_usd ?? 0)} Trust`;
  }
  if (event.event_type === 'agent_registered') {
    return 'Trust Passport pending';
  }
  if (event.event_type === 'heartbeat_received') {
    return 'Network liveness confirmed';
  }
  return shortHash(event.event_hash);
}

function calculateAgentGdpBreakdown({ contracts, events }) {
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  const monthKey = now.toISOString().slice(0, 7);
  const rows = [];

  for (const contract of contracts) {
    rows.push({
      value: Number(contract.quote?.requested_capacity ?? contract.terms?.requested_capacity ?? contract.escrow?.payment_amount_usd ?? 0),
      date: contract.settled_at ?? contract.prepared_at ?? contract.created_at,
    });
  }
  for (const event of events) {
    rows.push({
      value: Number(event.value_usd ?? 0),
      date: event.created_at ?? event.timestamp ?? event.occurred_at,
    });
  }

  return rows.reduce((totals, row) => {
    const value = Number.isFinite(row.value) ? Math.max(0, row.value) : 0;
    const date = String(row.date ?? '');
    totals.lifetime += value;
    if (date.startsWith(todayKey)) {
      totals.today += value;
    }
    if (date.startsWith(monthKey)) {
      totals.month += value;
    }
    return totals;
  }, { today: 0, month: 0, lifetime: 0 });
}

function calculateTrustLocked(agents) {
  return agents.reduce((sum, agent) => {
    const value = Number(agent.collateral?.amount ?? agent.collateral_usd ?? agent.available_capacity ?? 0);
    return sum + (Number.isFinite(value) ? Math.max(0, value) : 0);
  }, 0);
}

function buildTrustRadar({ contracts, events }) {
  const cities = ['Sao Paulo', 'Madrid', 'Singapore', 'London', 'Dubai', 'New York', 'Lisbon', 'Seoul'];
  const services = ['Research Contract', 'Audit Contract', 'Market Analysis', 'Code Review', 'Risk Check'];
  const rows = [];

  for (const contract of contracts.slice(0, 5)) {
    const seed = hashNumberForServer(contract.contract_id ?? JSON.stringify(contract));
    rows.push({
      from: cities[seed % cities.length],
      to: cities[(seed + 3) % cities.length],
      label: contract.quote?.service ? `${contract.quote.service} Contract` : services[seed % services.length],
      status: contract.status ?? 'prepared',
    });
  }

  for (const event of events.slice(0, 5)) {
    const seed = hashNumberForServer(event.event_hash ?? event.agent_id ?? event.event_type);
    rows.push({
      from: cities[seed % cities.length],
      to: cities[(seed + 2) % cities.length],
      label: event.event_type === 'trust_created' ? 'Trust Current' : services[seed % services.length],
      status: event.event_type ?? 'trust_event',
    });
  }

  return rows.slice(0, 5);
}

function buildAgentBirths(agents) {
  return [...agents]
    .sort((left, right) => compareDates(right.registered_at ?? right.updated_at, left.registered_at ?? left.updated_at))
    .slice(0, 5)
    .map((agent) => ({
      agent_id: agent.agent_id,
      name: agent.name ?? agent.agent_id,
      service: (agent.services ?? [])[0] ?? 'general',
      timestamp: agent.registered_at ?? agent.updated_at,
      trust_state: agent.online ? 'LIVE' : 'TRUST_UNKNOWN',
    }));
}

function buildTrustHeatmap({ agents, ranking, events }) {
  const scores = new Map(ranking.map((agent) => [agent.agent_id, Number(agent.proof_of_trust_score ?? 0)]));
  const buckets = new Map();

  for (const agent of agents) {
    const cluster = inferAgentCluster(agent.services);
    const score = scores.get(agent.agent_id) ?? 0;
    const current = buckets.get(cluster) ?? { domain: cluster, score: 0, count: 0 };
    current.score += score + 1;
    current.count += 1;
    buckets.set(cluster, current);
  }

  for (const event of events) {
    const domain = event.event_type?.includes('contract') ? 'Contracts' : event.event_type?.includes('trust') ? 'Trust' : 'Ledger';
    const current = buckets.get(domain) ?? { domain, score: 0, count: 0 };
    current.score += Number(event.value_usd ?? 0) + 1;
    current.count += 1;
    buckets.set(domain, current);
  }

  const rows = [...buckets.values()].sort((left, right) => right.score - left.score);
  const max = Math.max(1, ...rows.map((row) => row.score));
  return rows.slice(0, 7).map((row) => ({
    ...row,
    intensity: Math.max(8, Math.round((row.score / max) * 100)),
  }));
}

function hashNumberForServer(value) {
  let hash = 0;
  const text = String(value ?? 'axp');
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
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
          linear-gradient(180deg, rgba(0, 0, 0, 0.08), rgba(1, 4, 7, 0.88) 80%),
          radial-gradient(circle at 50% 28%, rgba(255, 255, 255, 0.18), transparent 4rem),
          radial-gradient(circle at 15% 20%, rgba(137, 247, 189, 0.14), transparent 26rem),
          radial-gradient(circle at 85% 5%, rgba(143, 232, 255, 0.12), transparent 24rem),
          url("/axp-space-logo.png") center top / cover fixed no-repeat,
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
        background:
          linear-gradient(145deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.012) 42%, rgba(137, 247, 189, 0.035)),
          rgba(8, 14, 17, 0.76);
        backdrop-filter: blur(18px);
        box-shadow: 0 28px 90px rgba(0, 0, 0, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.08);
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
      .brand-mark {
        border: 1px solid rgba(213, 237, 244, 0.32);
        color: transparent;
        padding: 9px 12px;
        background: linear-gradient(135deg, #ffffff 0%, #aab4b9 25%, #30383d 45%, #f4fbff 62%, #69757a 100%);
        -webkit-background-clip: text;
        background-clip: text;
        letter-spacing: 0.08em;
        box-shadow: 0 0 26px rgba(137, 247, 189, 0.16), inset 0 0 18px rgba(255, 255, 255, 0.06);
      }
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
      .page-wordmark { margin: 8px 0 12px; line-height: 0.78; }
      .page-wordmark .metal-axp {
        display: block;
        color: transparent;
        background: linear-gradient(120deg, #ffffff 0%, #bdc8cd 15%, #566267 28%, #f4fbff 43%, #98a5ab 55%, #192024 66%, #edf7fa 80%, #6d7a80 100%);
        -webkit-background-clip: text;
        background-clip: text;
        font-size: clamp(72px, 9vw, 138px);
        font-weight: 950;
        text-shadow: 0 2px 0 rgba(255, 255, 255, 0.34), 0 16px 40px rgba(0, 0, 0, 0.85), 0 0 44px rgba(143, 232, 255, 0.28);
      }
      .page-wordmark .protocol-letters {
        display: block;
        margin-top: 16px;
        color: transparent;
        background: linear-gradient(180deg, #f9ffff 0%, #9ca8ad 44%, #1f292d 54%, #e5f1f3 100%);
        -webkit-background-clip: text;
        background-clip: text;
        font-size: clamp(17px, 2vw, 30px);
        font-weight: 500;
        letter-spacing: 0.54em;
        text-transform: uppercase;
      }
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
          <h1 class="page-wordmark" aria-label="AXP Dashboard">
            <span class="metal-axp">AXP</span>
            <span class="protocol-letters">DASHBOARD</span>
          </h1>
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

function renderTrustTape({ gdpBreakdown, trustLocked, discovery, trustFeed }) {
  const latest = trustFeed.items[0]?.title ?? 'AXP Trust Feed waiting for next event';
  return [
    `<span>Agent GDP today <strong>${formatUsd(gdpBreakdown.today)}</strong></span>`,
    `<span>Month <strong>${formatUsd(gdpBreakdown.month)}</strong></span>`,
    `<span>Lifetime <strong>${formatUsd(gdpBreakdown.lifetime)}</strong></span>`,
    `<span>Trust locked <strong>${formatUsd(trustLocked)}</strong></span>`,
    `<span>Scout targets <strong>${formatNumber(discovery.summary.scout_targets)}</strong></span>`,
    `<span>Trust unknown <strong>${formatNumber(discovery.summary.unverified_agents)}</strong></span>`,
    `<span>${escapeHtml(latest)}</span>`,
  ].join('');
}

function renderTrustRadarItems(items) {
  if (!items?.length) {
    return `<div class="empty">No live contract radar yet.</div>`;
  }

  return items.map((item) => `<div class="radar-item">
    <div class="radar-line">
      <strong>${escapeHtml(item.from)}</strong>
      <span>-></span>
      <strong>${escapeHtml(item.to)}</strong>
    </div>
    <span>${escapeHtml(item.label)} · ${escapeHtml(escapeStatus(item.status))}</span>
  </div>`).join('');
}

function renderAgentBirthItems(items) {
  if (!items?.length) {
    return `<div class="empty">No agent births yet.</div>`;
  }

  return items.map((item) => `<div class="birth-item">
    <strong>NEW AGENT BORN</strong>
    <span><code>${escapeHtml(item.agent_id)}</code> · ${escapeHtml(item.service)} · ${escapeHtml(item.trust_state)}</span>
  </div>`).join('');
}

function renderTrustHeatmap(rows) {
  if (!rows?.length) {
    return `<div class="empty">No trust heatmap yet.</div>`;
  }

  return rows.map((row) => `<div class="heat-row">
    <span>${escapeHtml(row.domain)}</span>
    <div class="heat-bar"><span style="width:${Math.min(100, Math.max(4, row.intensity))}%"></span></div>
    <code>${formatNumber(row.score)}</code>
  </div>`).join('');
}

function renderDiscoveryItems(items) {
  if (!items?.length) {
    return `<div class="empty">No discovery targets yet.</div>`;
  }

  return items.slice(0, 6).map((item) => `<div class="discovery-item">
    <strong>${escapeHtml(item.agent_id)}</strong>
    <span>${escapeHtml(item.source)} · ${escapeHtml(item.service)} · ${escapeHtml(item.trust_state)}</span>
  </div>`).join('');
}

function renderTrustFeedItems(items) {
  if (!items?.length) {
    return `<div class="empty">Trust Feed waiting for first event.</div>`;
  }

  return items.slice(0, 8).map((item) => `<div class="feed-item">
    <strong>${escapeHtml(item.title)}</strong>
    <span>${escapeHtml(item.impact)} · <code>${escapeHtml(shortHash(item.hash))}</code></span>
  </div>`).join('');
}

function escapeStatus(status) {
  return String(status ?? 'unknown').replace(/_/g, ' ').toUpperCase();
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
