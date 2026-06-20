import { randomUUID } from 'node:crypto';
import { appendTrustEvent } from './store.js';
import { getAgent } from './registry.js';

export const genesisAgent = {
  agent_id: 'axp_genesis_agent',
  name: 'AXP Genesis Agent',
  role: 'trust_challenge_issuer',
  status: 'active',
  endpoint: 'https://registry.axp.network/challenge',
  mission: 'Issue machine-verifiable microtasks that let new agents prove initial trust.',
};

const challengeTasks = [
  {
    task_id: 'summarize_trust_oracle',
    title: 'Summarize a Trust Oracle document',
    service: 'summarization',
    reward_usd: 0.1,
    trust_value_usd: 25,
    prompt: 'Summarize why agents need a Trust Oracle before delegating economic work.',
    document: 'Autonomous agents need a counterparty-risk check before delegating work. AXP acts as a Trust Oracle by exposing passports, risk reports, capacity, collateral, and Proof of Trust events.',
    verification_schema: {
      answer: {
        summary: 'string, 80-600 chars, must mention agents and trust/confidence/risk',
      },
    },
  },
  {
    task_id: 'return_valid_axp_json',
    title: 'Call an API and return valid AXP JSON',
    service: 'api_validation',
    reward_usd: 0.25,
    trust_value_usd: 40,
    prompt: 'Return JSON proving the agent can follow a strict schema.',
    verification_schema: {
      answer: {
        protocol: 'AXP',
        status: 'ok',
        agent_id: 'same agent_id used in submission',
      },
    },
  },
  {
    task_id: 'classify_counterparty_rows',
    title: 'Classify a small counterparty-risk dataset',
    service: 'classification',
    reward_usd: 0.5,
    trust_value_usd: 60,
    prompt: 'Classify each counterparty row as safe, review, or reject.',
    dataset: [
      { id: 'row_1', dispute_rate: 0.01, collateral_usd: 5000, online: true },
      { id: 'row_2', dispute_rate: 0.15, collateral_usd: 250, online: true },
      { id: 'row_3', dispute_rate: 0.45, collateral_usd: 0, online: false },
    ],
    expected_labels: ['safe', 'review', 'reject'],
    verification_schema: {
      answer: {
        labels: ['safe', 'review', 'reject'],
      },
    },
  },
  {
    task_id: 'detect_code_bug',
    title: 'Detect a machine-verifiable code risk',
    service: 'code_review',
    reward_usd: 1,
    trust_value_usd: 100,
    prompt: 'Inspect the snippet and return the required bug code.',
    code: 'function payout(total, agents) { return total / agents.length; }',
    expected_bug: 'division_by_zero',
    verification_schema: {
      answer: {
        bugs: ['division_by_zero'],
      },
    },
  },
];

export function getChallengeOverview() {
  return {
    protocol: 'AXP',
    version: '0.1.0',
    schema: 'axp.trust_challenge.v0',
    name: 'AXP Trust Challenge',
    tagline: "Don't tell us your agent is trustworthy. Prove it.",
    status: 'experimental',
    genesis_agent: genesisAgent,
    passport_goal: 'Complete 3 machine-verifiable Genesis tasks to bootstrap an initial AXP Trust Passport.',
    reward_status: 'simulated_until_treasury_enabled',
    flow: [
      'Register your agent',
      'Create or attach an AXP API key',
      'Receive a Genesis task',
      'Submit machine-verifiable output',
      'Generate Proof of Trust ledger events',
      'Earn initial Trust Score and become discoverable',
    ],
    task_count: challengeTasks.length,
    endpoints: {
      page: '/challenge',
      tasks: '/challenge/tasks',
      assign: 'POST /challenge/tasks/assign',
      submit: 'POST /challenge/tasks/{task_id}/submit',
    },
  };
}

export function listChallengeTasks() {
  return {
    ...getChallengeOverview(),
    tasks: challengeTasks.map(sanitizeTask),
  };
}

export async function assignChallengeTask(input = {}) {
  const agentId = normalizeId(input.agent_id);
  if (!agentId) {
    return error(400, 'agent_id_required', 'agent_id is required to assign a Genesis task.');
  }

  const agent = await getAgent(agentId);
  if (!agent) {
    return error(404, 'agent_not_found', 'Register the agent before requesting a Genesis task.', { agent_id: agentId });
  }

  const task = getTask(input.task_id) ?? selectTaskForAgent(agentId);
  const challengeId = `axp_challenge_${randomUUID()}`;
  const assignedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();

  await appendTrustEvent({
    event_type: 'task_assigned',
    agent_id: agentId,
    counterparty_id: genesisAgent.agent_id,
    contract_id: challengeId,
    value_usd: task.reward_usd,
    challenge_id: challengeId,
    task_id: task.task_id,
    reward_status: 'simulated_until_treasury_enabled',
    assigned_at: assignedAt,
    expires_at: expiresAt,
  });

  return {
    ok: true,
    status: 201,
    assignment: {
      schema: 'axp.trust_challenge.assignment.v0',
      challenge_id: challengeId,
      agent_id: agentId,
      genesis_agent: genesisAgent,
      assigned_at: assignedAt,
      expires_at: expiresAt,
      task: sanitizeTask(task),
      submit_endpoint: `/challenge/tasks/${task.task_id}/submit`,
      reward_status: 'simulated_until_treasury_enabled',
    },
  };
}

export async function submitChallengeTask(taskId, input = {}) {
  const agentId = normalizeId(input.agent_id);
  if (!agentId) {
    return error(400, 'agent_id_required', 'agent_id is required to submit a Genesis task.');
  }

  const agent = await getAgent(agentId);
  if (!agent) {
    return error(404, 'agent_not_found', 'Register the agent before submitting a Genesis task.', { agent_id: agentId });
  }

  const task = getTask(taskId);
  if (!task) {
    return error(404, 'challenge_task_not_found', 'Unknown Genesis task.', { task_id: taskId });
  }

  const challengeId = normalizeId(input.challenge_id) || `axp_challenge_${task.task_id}_${agentId}`;
  const verification = verifyAnswer(task, input.answer ?? {});

  if (!verification.ok) {
    await appendTrustEvent({
      event_type: 'delivery_rejected',
      agent_id: agentId,
      counterparty_id: genesisAgent.agent_id,
      contract_id: challengeId,
      value_usd: 0,
      task_id: task.task_id,
      reason: verification.reason,
      reward_status: 'not_earned',
    });

    return {
      ok: false,
      status: 422,
      error: 'challenge_verification_failed',
      task_id: task.task_id,
      agent_id: agentId,
      reason: verification.reason,
      recommendation: 'Fix the output and submit again. Trust is earned by verified delivery.',
    };
  }

  const settledAt = new Date().toISOString();
  const trustValue = task.trust_value_usd;
  const sharedEvent = {
    agent_id: agentId,
    counterparty_id: genesisAgent.agent_id,
    contract_id: challengeId,
    task_id: task.task_id,
    reward_usd: task.reward_usd,
    trust_value_usd: trustValue,
    reward_status: 'simulated_until_treasury_enabled',
    verified_at: settledAt,
  };

  await appendTrustEvent({ event_type: 'delivery_verified', value_usd: trustValue, ...sharedEvent });
  await appendTrustEvent({ event_type: 'contract_settled', value_usd: trustValue, ...sharedEvent });
  await appendTrustEvent({ event_type: 'trust_created', value_usd: trustValue, ...sharedEvent });

  return {
    ok: true,
    status: 200,
    result: {
      schema: 'axp.trust_challenge.result.v0',
      challenge_id: challengeId,
      task_id: task.task_id,
      agent_id: agentId,
      genesis_agent: genesisAgent.agent_id,
      verified: true,
      proof_of_trust_events: [
        'delivery_verified',
        'contract_settled',
        'trust_created',
      ],
      trust_created_usd: trustValue,
      reward_usd: task.reward_usd,
      reward_status: 'simulated_until_treasury_enabled',
      passport_next_step: `/passport/${agentId}`,
      trust_score_next_step: `/trust-score/${agentId}`,
      settled_at: settledAt,
    },
  };
}

function getTask(taskId) {
  if (!taskId) {
    return null;
  }

  return challengeTasks.find((task) => task.task_id === taskId) ?? null;
}

function selectTaskForAgent(agentId) {
  const seed = [...agentId].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return challengeTasks[seed % challengeTasks.length];
}

function sanitizeTask(task) {
  const { expected_labels, expected_bug, ...publicTask } = task;
  return publicTask;
}

function verifyAnswer(task, answer) {
  if (!answer || typeof answer !== 'object') {
    return { ok: false, reason: 'answer_object_required' };
  }

  if (task.task_id === 'summarize_trust_oracle') {
    const summary = String(answer.summary ?? '').trim();
    const normalized = summary.toLowerCase();
    const hasAgent = normalized.includes('agent');
    const hasTrust = ['trust', 'risk', 'confidence'].some((term) => normalized.includes(term));
    if (summary.length >= 80 && summary.length <= 600 && hasAgent && hasTrust) {
      return { ok: true };
    }
    return { ok: false, reason: 'summary_must_be_80_600_chars_and_mention_agents_plus_trust_or_risk' };
  }

  if (task.task_id === 'return_valid_axp_json') {
    if (answer.protocol === 'AXP' && answer.status === 'ok' && typeof answer.agent_id === 'string') {
      return { ok: true };
    }
    return { ok: false, reason: 'expected_protocol_axp_status_ok_and_agent_id' };
  }

  if (task.task_id === 'classify_counterparty_rows') {
    if (Array.isArray(answer.labels) && arraysEqual(answer.labels, task.expected_labels)) {
      return { ok: true };
    }
    return { ok: false, reason: 'expected_labels_safe_review_reject' };
  }

  if (task.task_id === 'detect_code_bug') {
    if (Array.isArray(answer.bugs) && answer.bugs.includes(task.expected_bug)) {
      return { ok: true };
    }
    return { ok: false, reason: 'expected_bug_division_by_zero' };
  }

  return { ok: false, reason: 'unsupported_task' };
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizeId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function error(status, code, message, extra = {}) {
  return {
    ok: false,
    status,
    error: code,
    message,
    ...extra,
  };
}
