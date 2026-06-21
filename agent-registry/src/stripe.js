// Thin Stripe wrapper for recurring Hosting / Trust API subscriptions.
//
// The SDK is imported lazily and all secrets come from the environment, so the
// module loads fine (and node --check passes) even where Stripe isn't installed
// or configured. Set STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET on the server.

let stripeClient = null;

async function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!stripeClient) {
    const Stripe = (await import('stripe')).default;
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}

export function stripeEnabled() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export async function createSubscriptionCheckout({ priceId, agentId, ownerRef, planSku, successUrl, cancelUrl, customerEmail } = {}) {
  const stripe = await getStripe();
  if (!stripe) return { ok: false, status: 503, error: 'stripe_disabled', hint: 'set STRIPE_SECRET_KEY' };
  if (!priceId) return { ok: false, status: 400, error: 'price_not_configured', hint: 'set the plan Stripe price id env var' };

  const metadata = { agent_id: agentId || '', plan_sku: planSku || '', owner_ref: ownerRef || '' };
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: agentId || ownerRef || undefined,
      customer_email: customerEmail || undefined,
      metadata,
      subscription_data: { metadata },
    });
    return { ok: true, status: 200, url: session.url, id: session.id };
  } catch (err) {
    return { ok: false, status: 502, error: 'stripe_checkout_failed', detail: err?.message || String(err) };
  }
}

export async function constructWebhookEvent(rawBody, signature) {
  const stripe = await getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return { ok: false, error: 'stripe_webhook_disabled' };
  try {
    const event = stripe.webhooks.constructEvent(rawBody, signature, secret);
    return { ok: true, event };
  } catch (err) {
    return { ok: false, error: 'invalid_signature', detail: err?.message || String(err) };
  }
}
