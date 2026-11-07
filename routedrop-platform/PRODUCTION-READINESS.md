# RouteDrop production readiness and incident ownership gate

**Status: NOT APPROVED for production.** This checklist must be signed off before authorizing live keys, production deployment, or customer payments. The deferred-booking feature is currently test-key-only by design; a separate, reviewed go-live implementation will be needed.

## Incident response ownership — assignments pending

| Responsibility | Proposed responsibility | Assigned individual | Backup | Accepted/on-call coverage |
|---|---|---|---|---|
| Incident commander | RouteDrop service owner: coordinate incidents, customer communications and go/no-go | **Unassigned** | **Unassigned** | **Not confirmed** |
| Technical responder | Investigate Render, Neon, webhook delivery, deployments and app errors | **Unassigned** | **Unassigned** | **Not confirmed** |
| Payments responder | Reconcile Stripe Connect payments, transfers, refunds and disputes | **Unassigned** | **Unassigned** | **Not confirmed** |
| Security and privacy | Triage account compromise or data exposures, preserve evidence and coordinate legal review | **Unassigned** | **Unassigned** | **Not confirmed** |

No individual is appointed merely because of their current business or repository role. Confirm each individual's permission, contact method, working hours and backup before filling this table. The incident response targets in `PAYMENT-INCIDENT-RUNBOOK.md` do not promise 24/7 coverage.

## Security review — repository evidence

- **Confirmed:** Webhook endpoint verifies Stripe signatures and records processed event IDs; test-only deferred payment is guarded by `sk_test_`; POST actions include origin/CSRF checks; authentication uses session cookies and bcrypt password hashes; password resets invalidate sessions.
- **Fix under review:** Server's previous PostgreSQL client used `ssl: {rejectUnauthorized:false}`, disabling remote server certificate validation. Security PR replaces it with verified TLS and checks unsafe connection-string overrides. Confirm Neon connection works with the actual provided certificate chain before rollout.
- **Further review:** Session cookies are marked `Secure` only with `NODE_ENV=production`; verify deployment environment makes this true on HTTPS for every public deployment. No claim of secure cookie behavior is made until verified at runtime.
- **Further review:** Express rate limits currently use process-local memory; assess a shared distributed limit and multiple instances before scaling, including log-in and payment endpoints.
- **Further review:** Verify MFA / privileged-account security, admin access restrictions, secret rotation, dependency vulnerabilities, least privilege and retention/deletion policies with dedicated evidence.
- **Further review:** Review a production backup and restore drill, recovery time/objectives, Stripe event redelivery, monitoring fail-open/closed behavior, and formal external security testing.
- **Further review:** Confirm customer terms, vendor/merchant policies, refunds and dispute disclosures, accessibility and privacy obligations with qualified counsel.

## Production release gates

- [ ] Document named primary/backup responders and out-of-hours escalation coverage.
- [ ] Review and run database TLS patch tests on disposable PostgreSQL, then verify actual staging DB connection and certificate chain.
- [ ] Verify secure cookies, CSRF, origin, and password-reset behavior through a browser and HTTP test.
- [ ] Run backup/restore drill in a separate environment; verify retention, encryption and database access controls.
- [ ] Verify independent webhook-delivery alerts from Stripe and Render, and practice a delayed/missing-webhook incident.
- [ ] Document safe toggles to suspend new charges without modifying payment status or silently losing events.
- [ ] Test refunds and payment recovery under errors/outages using Stripe test mode; reconcile transfers and fees.
- [ ] Run dependency review and independent security assessment; document remediation.
- [ ] Review legal/privacy/security terms and customer support escalation.
- [ ] Explicitly approve live-payment design changes separately. Do not change `ROUTEDROP_LIVE_APPROVED`, install live Stripe keys, or switch staging settings on the strength of this checklist.

## Release sign-off

**Service owner:** pending

**Technical/security reviewer:** pending

**Payments reviewer:** pending

**Date and evidence links:** pending

**Decision:** HOLD — production authorization not granted.
