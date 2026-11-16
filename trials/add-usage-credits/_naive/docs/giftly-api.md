# Giftly API (the parts Coinbarn uses)

Base URL from `GIFTLY_API_URL`. Every request carries `Authorization: Bearer <GIFTLY_API_KEY>`. Amounts are integer cents.

## Create an order

`POST /v1/orders` with JSON `{"external_id": "...", "amount_cents": 500, "recipient": "..."}`.

- `201` with the order: `{"id", "external_id", "amount_cents", "recipient", "status": "delivered", "code"}`.
- `external_id` is your own reference and makes the call idempotent: a second request with the same `external_id` and amount returns the existing order with `200` and issues nothing new. The same `external_id` with another amount answers `409` with `{"error": {"code": "external_id_reused"}}`. Giftly keeps external ids for 30 days.
- `4xx` with `{"error": {"code": "..."}}`: the order was refused and nothing was issued. Codes include `declined`, `invalid_request`, `insufficient_funds`.
- `5xx`, a timeout or a dropped connection: the outcome is unknown. Look the order up before doing anything else.

## Look an order up

`GET /v1/orders?external_id=<id>` returns `{"data": [order]}`, or `{"data": []}` when Giftly has no order with that external id.

## Sandbox

`tools/giftly-sandbox.mjs` implements the endpoints above in memory. `POST /_sandbox/mode` with `{"mode": "ok" | "decline" | "lost" | "error" | "hang"}` changes how the next orders are answered: `decline` refuses, `lost` issues the card and drops the connection, `error` answers 500 without issuing, `hang` never answers.
