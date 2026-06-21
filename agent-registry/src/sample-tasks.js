// Realistic work payloads per service, so a hosted agent that picks one up has
// actual content to act on — and Claude produces a complete deliverable instead of
// asking "please provide the content". Used by the swarm to seed the intent feed.

export const SAMPLE_TASKS = {
  translation: [
    {
      title: 'Translate product copy to Spanish & Portuguese',
      description: 'Translate the following marketing copy to Brazilian Portuguese (PT-BR) and Latin American Spanish (ES-LATAM). Return both versions, labeled.\n\n"AXP lets anyone launch and own a productive AI agent in 60 seconds. No code, no servers — pick a template, launch it, and AXP keeps it alive, connected to live demand, and earning with on-chain proof of trust."',
    },
    {
      title: 'Localize an onboarding email to Spanish',
      description: 'Translate to neutral Latin American Spanish, keeping a warm tone:\n\n"Welcome aboard! Your agent is live and already looking for work. You can track its earnings and trust score from your dashboard anytime. Reply here if you need a hand."',
    },
  ],
  code_review: [
    {
      title: 'Review a JS utility for bugs and risks',
      description: 'Review this code and list (1) bugs, (2) security/risk concerns, (3) concrete fixes:\n\nfunction parseAmount(s) { return parseInt(s); }\nfunction applyDiscount(price, pct) { return price - price * pct; }\nfunction isAdmin(user) { if (user.role = "admin") return true; return false; }\nasync function getUser(id) { return await db.query("SELECT * FROM users WHERE id = " + id); }',
    },
  ],
  research: [
    {
      title: 'Brief: AI agent marketplaces landscape',
      description: 'Produce a concise (<250 words) research brief on the current AI agent marketplace landscape: who the main players are, what they monetize, and where demand is growing. Be factual; flag any uncertainty.',
    },
    {
      title: 'Summarize the case for on-chain agent reputation',
      description: 'Write a tight executive summary (<200 words) arguing why verifiable, on-chain reputation matters for an economy of autonomous AI agents, and one credible counter-argument.',
    },
  ],
  data_processing: [
    {
      title: 'Classify support tickets by urgency',
      description: 'Classify each ticket as low/medium/high urgency and return JSON (array of {ticket, urgency}):\n["server is down for all users", "typo in the footer", "payment failed for a paying customer", "feature request: dark mode", "login broken on Safari"]',
    },
  ],
  content_writing: [
    {
      title: 'Write a one-liner + 3 tweets for a launch',
      description: 'Product: AXP — launch and own a productive AI agent in 60 seconds, no code. Write one punchy one-liner and 3 distinct tweets (each under 280 chars), no hashtags spam.',
    },
  ],
  lead_generation: [
    {
      title: 'Draft 3 target lead profiles (AI SDR)',
      description: 'For a B2B SaaS selling observability tooling to fintech startups, describe 3 qualified target profiles (role, company stage, why they fit) and a one-line outreach angle for each. Do not invent real personal data.',
    },
  ],
  analysis: [
    {
      title: 'Quick risk read on a new counterparty',
      description: 'Given an agent with 4 settled contracts, 1 failed, $0 stake, and 12 days of history, write a short risk assessment (3-4 sentences) and a recommended max exposure with rationale.',
    },
  ],
};

const GENERIC = {
  title: 'Complete a short professional task',
  description: 'Produce a concise, high-quality result for the requested service. If details are missing, make reasonable assumptions and state them.',
};

export function sampleTaskFor(service) {
  const list = SAMPLE_TASKS[service];
  if (!list || list.length === 0) return { ...GENERIC, service: service || 'general' };
  const pick = list[Math.floor(Math.random() * list.length)];
  return { ...pick, service };
}

export const SAMPLE_SERVICES = Object.keys(SAMPLE_TASKS);
