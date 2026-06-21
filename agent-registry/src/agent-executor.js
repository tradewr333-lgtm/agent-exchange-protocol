// Real task execution for hosted agents — powered by Claude (Anthropic).
//
// This is what makes a launched agent genuinely productive: instead of only
// recording synthetic settlements, the hosted-agent worker hands the agent a real
// task (from a matching open intent, or a template briefing) and the agent produces
// an actual deliverable with an LLM, which is then attached to the settlement.
//
// buildPrompt is pure (testable). executeTask is env-gated (ANTHROPIC_API_KEY) and
// lazy — the module loads fine and node --check passes even with no key/network.

const TEMPLATE_PROMPTS = {
  research: {
    system: 'You are an autonomous research agent on the AXP network. Given a topic or question, produce a concise, well-structured research brief: key findings, notable players/data points, and a short conclusion. Be factual and avoid fabrication; flag uncertainty.',
    sample: 'Research the current landscape of AI agent marketplaces: who the main players are, what they charge for, and where demand is growing. Summarize in under 300 words.',
  },
  translation: {
    system: 'You are a translation & localization agent on the AXP network. Translate the provided content accurately, preserving tone and meaning. If no target language is given, translate English↔Spanish. Return only the translation unless asked otherwise.',
    sample: 'Translate to Spanish and Portuguese: "AXP lets anyone launch and own a productive AI agent in 60 seconds."',
  },
  code_review: {
    system: 'You are a code review agent on the AXP network. Review the provided code or change description and return: (1) bugs, (2) security/risk concerns, (3) concrete suggestions. Be specific and prioritized.',
    sample: 'Review this function for bugs and risks:\n\nfunction add(a, b) { return a - b; }\nfunction divide(a, b) { return a / b; }',
  },
  data_processing: {
    system: 'You are a data processing agent on the AXP network. Clean, classify, or transform the provided data as requested and return structured, usable output (prefer compact JSON or a table).',
    sample: 'Classify these support tickets by urgency (low/medium/high) and return JSON: ["server is completely down", "typo in the footer", "payment failed for a customer", "feature request for dark mode"]',
  },
  leadgen: {
    system: 'You are an AI SDR / lead generation agent on the AXP network. Given an ideal customer profile, produce qualified lead ideas with a short rationale and a suggested outreach angle for each. Do not invent real personal data; describe target profiles.',
    sample: 'Generate 3 qualified lead profiles for a B2B SaaS selling observability tooling to fintech startups. Include why they fit and an outreach angle.',
  },
};

export function buildPrompt(templateId, task) {
  const t = TEMPLATE_PROMPTS[templateId] || TEMPLATE_PROMPTS.research;
  const trimmed = typeof task === 'string' ? task.trim() : '';
  return { system: t.system, task: trimmed || t.sample, usedSample: !trimmed };
}

export function llmEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function activeModel() {
  return process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
}

// Execute one task with Claude. Returns { ok, output, model, task } or { ok:false, reason }.
export async function executeTask({ template_id, task, maxTokens = 700 } = {}) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, reason: 'llm_not_configured' };

  const { system, task: prompt } = buildPrompt(template_id, task);
  const model = activeModel();
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, reason: 'llm_error', status: res.status, detail: detail.slice(0, 300) };
    }
    const data = await res.json();
    const output = (data.content || [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n')
      .trim();
    return { ok: true, output, model, task: prompt };
  } catch (err) {
    return { ok: false, reason: 'llm_exception', detail: err?.message || String(err) };
  }
}
