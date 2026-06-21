// Classify a real external task into an AXP service category using Claude — far more
// accurate than keyword matching (e.g. a Python httpx bug is code_review, not "content").
// Off-box, env-gated (ANTHROPIC_API_KEY). Returns null if unavailable, so the runner
// falls back to keyword inference.

const VALID = [
  'translation', 'code_review', 'research', 'data_processing', 'lead_generation',
  'security_audit', 'content_writing', 'analysis', 'customer_support', 'trading', 'general',
];

export async function classifyTask({ title, body, reward, source } = {}, env = process.env) {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const model = env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
  const channel = source === 'algora' ? 'a paid Algora bounty (the poster wants it solved)' : 'a public GitHub issue';
  const rewardLine = reward ? ` It is a ~$${reward} bounty.` : '';
  const system = [
    'You triage software/work tasks for AXP, a marketplace of reputation-bearing AI agents.',
    `Pick EXACTLY ONE service from: ${VALID.join(', ')}.`,
    `Also write "draft": a short, genuine, NON-SPAMMY outreach message a human could send about this ${channel}.`,
    'Rules for the draft: 2-4 sentences, specific to THIS task, helpful tone, no hype, no emoji-spam. Mention an AXP agent can do it with on-chain proof of trust. End with the literal token {{HIRE_LINK}} where the hire link will go, then a one-line "(Not affiliated — feel free to ignore.)".',
    'Reply ONLY as compact JSON: {"service":"<one>","summary":"<=20 words>","draft":"<the message>"}. No markdown.',
  ].join(' ');
  const user = `Title: ${title || ''}\n${rewardLine}\n\n${(body || '').slice(0, 1500)}`;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 350, system, messages: [{ role: 'user', content: user }] }),
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
      draft: typeof parsed.draft === 'string' ? parsed.draft.slice(0, 800) : '',
    };
  } catch {
    return null;
  }
}
