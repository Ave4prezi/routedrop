# RouteDrop staging payment monitoring

The `monitor-deferred.js` command is a **read-only** health and reconciliation check; it does not initiate, retry, cancel, or refund payments. It refuses to run unless `ROUTEDROP_STAGING_LOCK=true`, `STRIPE_SECRET_KEY` is a Stripe **test** key, and `DATABASE_URL` is provided. Run from the `routedrop-platform` directory with `node monitor-deferred.js`.

## Checks

- Payment stuck in `payment_processing` for at least 15 minutes.
- Payment failure, unresolved recovery, or `needs_review` older than 30 minutes.
- Processing or manually reviewable refund older than 15 minutes.
- Recently settled bookings (paid in the last seven days) match Stripe amount, currency, application fee, connected account, and successful intent.
- Refunded bookings have full refunded amount, matching successful Stripe refund, and stored refund ID.
- Failed email outbox records.

Results are JSON. Exit code 0 means no findings; 1 means warning(s); 2 means critical issue or check failure. **A clean report does not certify Stripe webhook delivery**, because unprocessed or undelivered webhook attempts cannot be observed through this database read alone. Monitor Stripe webhook delivery failures separately using Stripe Dashboard event destinations and Render HTTP 4xx/5xx logs.

## Operational use

Install as a separately scheduled, **staging-only** job with access to the staging database and Stripe sandbox credentials. Deliver nonzero exit-code alerts to your approved incident channel; avoid putting credentials, customer emails, raw Stripe objects, or card data in logs. The command itself does not install a scheduler or send notifications.

Do not run against production, and do not retry ambiguous charges or refunds. For a discrepancy, reconcile in Stripe Dashboard before changing any booking or issuing refunds. Review connection TLS settings for the actual database provider. For launch readiness, add production-safe monitoring after review, explicit approval, and a dedicated secrets and incident response plan.
