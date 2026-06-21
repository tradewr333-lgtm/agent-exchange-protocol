// Classify a real external task into an AXP service category using Claude — far more
// accurate than keyword matching (e.g. a Python httpx bug is code_review, not "content").
// Off-box, env-gated (ANTHROPIC_API_KEY). Returns null if unavailable, so the runner
// falls back to keyword inference.

const VALID = [
  'translation', 'code_review', 'research', 'data_processing', 'lead_generation',
  'security_audit', 'content_writing', 'analysis', 'customer_support', 'trading', 'general',
];

export async function classifyTask({ title, body } = {}, env = process.env) {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const model = env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
  const system = `You categorize software/work tasks for an AI-agent marketplace. Choose EXACTLY ONE service from this list: ${VALID.join(', ')}. Reply ONLY as compact JSON: {"service":"<one>","summary":"<=20 words on how an AI agent could help>"}. No prose, no markdown.`;
  const user = `Title: ${title || ''}\n\n${(body || '').slice(0, 1500)}`;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 120, system, messages: [{ role: 'user', content: user }] }),
      signal: AbortSignal.timeout(Number(env.AXP_BIZDEV_TIMEOUT_MS) || 15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    return {
      service: VALID.includes(parsed.service) ? parsed.service : 'general',
      summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 160) : '',
    };
  } catch {
    return null;
  }
}
