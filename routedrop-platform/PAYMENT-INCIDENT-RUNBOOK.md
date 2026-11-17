# RouteDrop payment incident response (staging draft)

**Scope:** Staging beta only. No live Stripe charges may be enabled by this document. All incident operators must use least-privileged access and avoid sharing customer data, secrets, or complete payment records in chats, tickets or alerts.

## Monitoring channels and limitations
- ChatGPT hourly **RouteDrop Staging Payment Watch** reads the staging Neon database, checks the Render staging webhook error logs when accessible, and optionally verifies Stripe sandbox payments/refunds. It sends notifications for actionable findings or monitoring blind spots. Confirm task execution history and notification delivery before relying on it.
- `node routedrop-platform/monitor-deferred.js` is a separate, manual read-only reconciliation command (staging lock and Stripe test key are required). It has not been installed as a cron job; do not assume its exit codes are being delivered anywhere.
- A clean Neon report **does not guarantee successful Stripe webhook delivery**; inspect Stripe Event Destinations delivery history and Render 4xx/5xx request logs.
- A failed monitor or inaccessible connector is itself a monitoring blind spot, not an all-clear.

## Severity and response targets (proposed)
| Severity | Examples | Initial response target |
| --- | --- | --- |
| SEV-1 | Confirmed duplicate charge, wrong recipient/amount, unauthorized live charging, significant data leak | Immediately suspend new charges using established approved operational controls; notify service owner and payment lead; involve Stripe support |
| SEV-2 | Payment status contradicts Stripe, failed webhook backlog, processing stuck >15 minutes, refund status unreconciled >15 minutes | Triage within 30 minutes during staffed coverage |
| SEV-3 | Failed notification, stale failed card or recovery >30 minutes, monitor unavailable | Review within one business day; escalate if money or customer impact is identified |

Targets are operating recommendations, **not** a claim of round-the-clock coverage. Assign named primary and backup responders and ensure someone is actually available before promising customer-facing response times.

## Read-only triage checklist
1. Record alert timestamp (UTC), booking ID, severity, current state, detected age, and monitoring source. Never paste customer emails or payment card details.
2. In **staging Neon only**, read the affected `deferred_bookings`, matching `deferred_refund_requests`, and recent `stripe_events` rows; do not manually edit status fields.
3. In the **correct Stripe sandbox account**, retrieve the booking's stored PaymentIntent, Checkout session, charge and refund IDs; verify amount, currency, customer, merchant destination, 8% application fee, payment status, and whether a charge or transfer actually succeeded.
4. For missing or delayed webhooks, compare Stripe Event Destinations attempt status and Render request logs. Never assume that an absent local event means Stripe never charged a card.
5. For an ambiguous API timeout or duplicate event, **do not issue a fresh payment/refund**, rotate idempotency keys, or replay an event blindly; reconcile the original Stripe operation first.
6. For a recovered payment, inspect both the original **canceled** PaymentIntent and the successful recovery PaymentIntent. There must be no additional successful charge.
7. For a refund, verify `succeeded` and confirm the connected-account transfer reversal and application-fee refund. If uncertain, escalate to the payment lead/Stripe support.
8. Record impact, timestamps, exact Stripe object IDs, action taken, owner, and next check in a restricted incident log. Communicate the outcome to affected parties without exposing card data.

## Escalation routing
- **Primary:** RouteDrop service owner (must be assigned before production).
- **Backup:** Technical operator with access to staging logs and Stripe sandbox (must be assigned).
- **Payment processor:** Stripe Support, using account dashboard/support channel for confirmed processor issues.
- **Security incident:** Follow a separately approved security response policy, restrict exposure, preserve evidence, and consider applicable notification requirements with legal counsel.

## Operational guardrails
- No production launch or live keys are authorized by a monitoring test, CI pass, or incident runbook.
- No direct database mutation, manual status reset, automatic retry, unapproved refund, or direct replay of payment-bearing requests.
- Confirm any pause/disable plan in the application's existing approved operational controls, not by improvising during an incident.
- Run a simulation for duplicate charge, expired Checkout, absent webhooks, and reconciliation outages before authorizing production.
- Validate service backup/restore and keep evidence of successful rehearsals.
- Before launch: establish real alert destination (PagerDuty/email/incident channel), assigned staffed escalation owners, independent Stripe webhook delivery alerts, and a policy for monitoring outages.

## Suggested incident record
```
ID:
Opened (UTC):
Environment: staging
Severity:
Booking ID:
Stripe references (restricted):
Observed state:
Stripe independently verified:
Customer/business impact:
Actions approved and taken:
Primary / backup owner:
Next review time:
Resolved (UTC):
Follow-up prevention:
```
