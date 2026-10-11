# ADR 0006: KYB callback mode with signed, idempotent webhooks

- Status: accepted
- Date: 2026-10-10

## Context

Real KYB providers are asynchronous: registry lookups, document checks and human review take
minutes to days. A job cannot stay open that long, and polling wastes calls and delays results.
Providers instead call back a URL. That URL is public, so anyone could post a forged
"verified, no watchlist hit" result, replay an old one, or the provider itself may deliver the
same event several times, late or out of order.

## Decision

- `KYB_MODE=callback` (default stays `sync`). The worker sends the verification request and stores
  the assessment as `AWAITING_CALLBACK` with the provider reference. A job redelivered in this state
  does not send a second request.
- `POST /api/v1/webhooks/kyb` is authenticated by signature, not by user JWT:
  `X-Kyb-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`.
  The timestamp is inside the MAC, requests older or newer than 5 minutes are rejected, comparison
  is constant-time, and several secrets are accepted at once (`KYB_WEBHOOK_SECRETS=new,old`) for
  rotation. The check runs in a guard, before body validation, on the raw request bytes.
- Idempotency: `webhook_events` has `UNIQUE (provider, event_id)`. Recording the receipt and
  applying the result happen in one transaction, so a duplicate delivery gets `200 duplicate` and
  changes nothing, while a failed processing attempt rolls the receipt back and the provider's retry
  is processed normally.
- Unknown references and callbacks for a superseded submission get `200 ignored`, so the provider
  stops retrying something that can never succeed.
- The result is applied by the same `RiskAssessmentCompleter` the synchronous worker uses.
- A callback that never arrives is failed by the reaper after `KYB_CALLBACK_TIMEOUT_MS`; ADMIN can
  retry, and a late callback for the old reference is then ignored.

## Consequences

- Forged, replayed and tampered callbacks are rejected (401) and never stored.
- Each provider event changes state at most once, even with concurrent deliveries (the application
  row lock serialises them).
- Processing happens inside the request; if it became slow, the provider's timeout could trigger
  retries. The fix then is "store, acknowledge, process asynchronously" via the outbox.

## Alternatives considered

| Option                              | Why not                                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| Poll the provider                   | Wasted calls, delayed results, rate limits                                                    |
| mTLS or asymmetric signatures       | Stronger key separation, but depends on what the provider offers; HMAC is the common baseline |
| Store the webhook, process it later | Faster acknowledgement, more moving parts; not needed at this volume                          |
