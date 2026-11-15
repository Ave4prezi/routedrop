# RouteDrop webhook reliability: staging-only draft

Status: implemented on a review branch, NOT deployed or activated. No live Stripe payments.

## Why this change exists

Stripe test-mode webhook attempts coincided with Render Free staging wake-ups in November 2026. Some deliveries timed out; subsequent manual delivery retries returned HTTP 200. A sleeping Render service cannot execute application code until it wakes. This change does NOT eliminate that cold-start interval or guarantee that Stripe will receive a fast response when the service is asleep.

It addresses a separate failure mode: waiting for a Stripe API lookup, booking update, or notification-outbox transaction before acknowledging an otherwise valid webhook.

## Operational design

The new inbox is strictly opt-in. It runs only with all these settings:
- ROUTEDROP_DEFERRED_BETA_ENABLED=true
- A Stripe sk_test_ secret, never live mode
- ROUTEDROP_STAGING_LOCK=true
- ROUTEDROP_WEBHOOK_INBOX_ENABLED=true
- A valid Stripe webhook signature secret and working staging PostgreSQL

With the flag disabled, the existing synchronous handler remains unchanged.

1. Verify Stripe signature before any state change. Bad signatures still receive 400.
2. Save the verified full Stripe event in a PostgreSQL inbox. Return 200 only AFTER the insert commits. No temporary in-memory-only acknowledgment.
3. In a separate worker, lock each due inbox event (FOR UPDATE SKIP LOCKED), run the original webhook business logic and existing event-ID deduplication inside one SQL transaction, and mark the inbox record processed only after success.
4. On failure, roll back all changes, retain the event, and retry in 15 seconds, 30 seconds, 60 seconds, etc., capped at one hour. Record an error name/code without logging the payload.
5. On restart, attempt to process pending inbox entries. Delete processed full-payload snapshots after seven days. The original event-ID deduplication table remains.

HTTP 200 now means only signature verified + event durably stored. It does not imply that a booking is paid or refunded. The UI should continue to rely on committed booking state.

## Tests

GitHub Actions runs the entire project regression suite on disposable PostgreSQL. Additional tests cover:
- Actual signed local HTTP requests, invalid signatures, duplicate webhooks and background completion.
- No application effect before queue processing.
- Atomic rollback, exponential backoff and recovery after worker restart.
- Concurrency safety across two workers.
- Processed-payload retention without deleting pending events.

All CI Stripe credentials are absent. No Stripe network operation occurs in these tests.

## Staging activation checklist

Do not activate merely because tests passed. Obtain explicit approval for an isolated staging-only deployment and migration, review a current backup, and verify the schema on staging before changing any flags. Keep auto-deploy off.

After activation, verify with new fictional Stripe test events only. Compare the Stripe webhook destination's individual delivery responses with RouteDrop inbox rows, processed booking state and Render logs. Avoid replaying existing bookings. Inspect pending events via read-only SQL:

    SELECT id, event_type, attempts, received_at, next_attempt_at, last_error
    FROM stripe_webhook_inbox
    WHERE processed_at IS NULL
    ORDER BY received_at ASC LIMIT 50;

Notify on pending events older than 15 minutes, growing retries, mismatched booking/Stripe settlement state, or inbox/worker inaccessibility.

If the feature must be disabled, verify the inbox is drained first. Turning the flag off while events remain queued stops processing those entries. Do not drop the table. Preserve reconciliation evidence.

## Remaining launch blocker

Render Free still sleeps after inactivity. No application-only change can guarantee webhook delivery while the host is waking. For production readiness, plan continuously available ingress/compute, monitor delivery outcomes, and complete genuine Stripe-to-staging signed webhook and browser-based checkout testing before accepting real customer money.
