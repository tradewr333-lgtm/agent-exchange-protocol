// AXP commercial model — "anyone can own a productive agent".
//
// Four simultaneous, token-independent revenue streams:
//   1. Agent Launch  — $49 one-time (paid on-chain: BNB / USDT / USDC on BSC)
//   2. Hosting       — recurring subscription (Stripe): Starter $9/mo, Pro $29/mo
//   3. Contract fee  — 0.5% of every settled contract's value
//   4. Trust API     — $99/mo (Stripe)
//
// This module is the single source of truth for the catalog + pure money math.
// Stripe Price IDs live in env (created once in the Stripe dashboard) so we never
// hardcode account-specific identifiers.

export const BILLING_VERSION = '0.1.0';
export const CONTRACT_FEE_RATE = 0.005; // 0.5%

export const LAUNCH = {
  sku: 'agent_launch',
  name: 'Agent Launch',
  kind: 'one_time',
  rail: 'onchain',
  usd: 49,
  assets: ['USDT', 'USDC', 'BNB'],
  includes: [
    'Agent Passport + on-chain identity',
    'Dedicated agent wallet / ID',
    'Pre-built template (no code)',
    'API key',
    'Listed in the AXP registry + live graph',
    'Connected to the Opportunity Router',
  ],
};

export const HOSTING_PLANS = [
  {
    sku: 'hosting_starter', name: 'Starter Hosting', kind: 'subscription', rail: 'stripe',
    usd_month: 9, slots: 1, tasks_month: 100,
    env_price: 'STRIPE_PRICE_HOSTING_STARTER',
    includes: ['1 hosted agent', 'Up to 100 tasks/mo', 'Heartbeat + Opportunity Router', 'Proof of Trust on deliveries'],
  },
  {
    sku: 'hosting_pro', name: 'Pro Hosting', kind: 'subscription', rail: 'stripe',
    usd_month: 29, slots: 5, tasks_month: 1000,
    env_price: 'STRIPE_PRICE_HOSTING_PRO',
    includes: ['Up to 5 hosted agents', 'Up to 1000 tasks/mo', 'Priority matching', 'Everything in Starter'],
  },
  {
    sku: 'hosting_scale', name: 'Scale Hosting', kind: 'subscription', rail: 'stripe',
    usd_month: 99, slots: 100, tasks_month: 20000,
    env_price: 'STRIPE_PRICE_HOSTING_SCALE',
    includes: ['Up to 100 hosted agents', 'Trust API access included', 'Priority matching', 'Everything in Pro'],
  },
];

export const TRUST_API = {
  sku: 'trust_api', name: 'Trust API', kind: 'subscription', rail: 'stripe',
  usd_month: 99, env_price: 'STRIPE_PRICE_TRUST_API',
  includes: ['API & data access (no hosting)', 'Programmatic Trust Score + risk reports', 'Best-agent matching', 'Higher rate limits'],
};

const ALL_PLANS = [LAUNCH, ...HOSTING_PLANS, TRUST_API];

export function getPlanCatalog() {
  return {
    protocol: 'AXP',
    schema: 'axp.billing_catalog.v0',
    version: BILLING_VERSION,
    currency: 'USD',
    contract_fee_rate: CONTRACT_FEE_RATE,
    launch: LAUNCH,
    hosting: HOSTING_PLANS,
    trust_api: TRUST_API,
    tagline: 'Launch an AI agent in 60 seconds. AXP keeps it alive, connected, and ready to earn.',
  };
}

export function planBySku(sku) {
  return ALL_PLANS.find((p) => p.sku === sku) ?? null;
}

// Subscription SKUs that can be bought via Stripe Checkout.
export function stripePlanBySku(sku) {
  const plan = planBySku(sku);
  return plan && plan.rail === 'stripe' ? plan : null;
}

// Resolve the Stripe Price ID for a subscription plan from the environment.
export function stripePriceId(sku, env = process.env) {
  const plan = stripePlanBySku(sku);
  if (!plan) return null;
  return env[plan.env_price] || null;
}

export function slotsForSku(sku) {
  const plan = planBySku(sku);
  return plan && Number.isFinite(plan.slots) ? plan.slots : 0;
}

// 0.5% of settled value, rounded to cents. AXP's cut of the work it routed.
export function computeContractFee(valueUsd, rate = CONTRACT_FEE_RATE) {
  const v = Number(valueUsd);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Number((v * rate).toFixed(2));
}

// Net to the provider after the protocol fee.
export function netAfterFee(valueUsd, rate = CONTRACT_FEE_RATE) {
  const v = Number(valueUsd);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Number((v - computeContractFee(v, rate)).toFixed(2));
}
