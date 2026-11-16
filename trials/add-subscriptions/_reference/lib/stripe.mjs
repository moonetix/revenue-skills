// Reads from the Stripe API. Every call names the API version the webhook endpoint uses, so
// fetched objects have the same shape as event payloads. A failure throws: the caller answers
// 5xx and Stripe delivers the event again.
export function createStripeApi(config) {
  async function get(path, params = {}) {
    const url = new URL(path, config.stripeApiUrl);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${config.stripeSecretKey}`, 'stripe-version': '2026-10-28.endive' },
      signal: AbortSignal.timeout(5000),
    });
    const body = await res.json().catch(() => null);
    if (res.status === 404 && body?.error?.code === 'resource_missing') return null;
    if (!res.ok || !body) throw new Error(`stripe: ${path} answered ${res.status}`);
    return body;
  }

  return {
    subscription: (id) => get(`/v1/subscriptions/${encodeURIComponent(id)}`),
    invoice: (id) => get(`/v1/invoices/${encodeURIComponent(id)}`),
    async invoicesPaidBy(paymentIntent) {
      const list = await get('/v1/invoice_payments', {
        'payment[type]': 'payment_intent',
        'payment[payment_intent]': paymentIntent,
        status: 'paid',
      });
      return (list?.data ?? []).map((p) => p.invoice).filter((id) => typeof id === 'string');
    },
    async *allSubscriptions() {
      let after = null;
      for (;;) {
        const fetchedMs = Date.now();
        const page = await get('/v1/subscriptions', { status: 'all', limit: 100, ...(after ? { starting_after: after } : {}) });
        for (const sub of page.data) yield { sub, fetchedMs };
        if (!page.has_more || page.data.length === 0) return;
        after = page.data[page.data.length - 1].id;
      }
    },
  };
}
