# Stripe API (the parts Coinbarn reads)

Base URL from `STRIPE_API_URL` (production: `https://api.stripe.com`). Every request carries `Authorization: Bearer <STRIPE_SECRET_KEY>`. Our account and webhook endpoint use API version `2026-10-28.endive`; send it as the `Stripe-Version` header. Amounts are integer cents, times are Unix seconds.

## Subscriptions

`GET /v1/subscriptions/{id}` returns the subscription as Stripe has it now. The fields we use:

```json
{
  "id": "sub_...",
  "object": "subscription",
  "status": "active",
  "customer": "cus_...",
  "cancel_at_period_end": false,
  "cancel_at": null,
  "canceled_at": null,
  "ended_at": null,
  "created": 1763300000,
  "latest_invoice": "in_...",
  "metadata": { "checkout_id": "plus_..." },
  "items": {
    "object": "list",
    "data": [
      {
        "id": "si_...",
        "object": "subscription_item",
        "price": { "id": "price_plus_monthly", "recurring": { "interval": "month", "interval_count": 1 } },
        "quantity": 1,
        "current_period_start": 1763300000,
        "current_period_end": 1765892000
      }
    ]
  }
}
```

`status` is one of `incomplete`, `incomplete_expired`, `trialing`, `active`, `past_due`, `canceled`, `unpaid`, `paused`. Since API version 2025-03-31 the current period is on the subscription items, not on the subscription.

`GET /v1/subscriptions?status=all&limit=100&starting_after=<id>` lists subscriptions, newest first: `{"object": "list", "data": [...], "has_more": true}`. Without `status` the list leaves canceled subscriptions out.

## Invoices

`GET /v1/invoices/{id}` returns an invoice. A subscription invoice names its subscription in `parent.subscription_details.subscription`, with a snapshot of the subscription's metadata in `parent.subscription_details.metadata`. `billing_reason` is `subscription_create` for the first invoice, `subscription_cycle` for a renewal and `subscription_update` for a change. The service period of a line is `lines.data[].period.start` and `.end`. `status` is `draft`, `open`, `paid`, `uncollectible` or `void`.

## Invoice payments

Charges no longer name their invoice. To find the invoice a charge paid:

`GET /v1/invoice_payments?payment[type]=payment_intent&payment[payment_intent]=<pi_...>&status=paid` returns `{"object": "list", "data": [{"id": "inpay_...", "invoice": "in_...", "status": "paid", "payment": {"type": "payment_intent", "payment_intent": "pi_..."}}]}`.

## Errors

`401` for a wrong key, `404` with `{"error": {"code": "resource_missing"}}` for an unknown id, `5xx` or no answer when Stripe has a problem.

## Sandbox

`STRIPE_SECRET_KEY=sk_test_local_0123456789 PORT=4200 node tools/stripe-sandbox.mjs` serves the reads above from memory. It never creates objects itself: `POST /_sandbox/objects` with `{"objects": [subscription or invoice, ...], "invoice_payments": [{"invoice": "in_...", "payment_intent": "pi_..."}]}` stores them.
