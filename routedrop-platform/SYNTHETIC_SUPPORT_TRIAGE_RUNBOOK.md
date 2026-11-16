# RouteDrop privacy/security/support triage drill — private synthetic preview

**Status: TEST ONLY. NOT A LIVE HELP DESK, EMERGENCY LINE, PRIVACY RIGHTS REQUEST CHANNEL OR BREACH RESPONSE SYSTEM.**
This code exists solely in the protected, paymentless preview. Real businesses and customers must not be invited to enter reports or documents.

## What is available in the prototype
- Only signed-in accounts with fictional `example.test`, `example.invalid`, or `ci.invalid` identities can create requests.
- One fixed category is accepted per submission. No description, attachment, phone, name, card detail, ID number, insurance document or arbitrary text can be supplied to this endpoint.
- Duplicate active requests in the same category by the same account are rejected. Requests are limited to 5 per hour per source IP as an additional test safeguard.
- Categories and example priorities: security concern (P0), privacy access/correction/deletion (P1), account access (P1), provider eligibility (P1), listing issue (P2), booking question (P2). These are **demonstration categories**, not real SLA commitments.
- The request owner sees only their own ticket identifiers, categories and statuses.
- Only a currently granted `support_reviewer` can read the fictional triage queue or record state transitions. A reviewer cannot act on their own ticket.
- The queue orders P0 first, then P1, P2; it excludes the operator's own requests. It intentionally displays only internal account IDs and category/status, not email addresses, evidence, or free text.
- States: `new`, `reviewing`, `escalated`, `closed_test`. Simulated escalation uses fixed `referred_security`, `referred_privacy`, or `referred_operations` dispositions. Every opening/change is written to a separate audit table.
- Closing a test request is **not** evidence that any real data request was fulfilled, breach contained, or actual customer contacted.
- The feature is enabled only when the existing synthetic-only provider launch gate is active (no Stripe key). Its routes fail closed elsewhere.

## Fictional tabletop walk-through

1. Prepare a disposable PostgreSQL database and preview-only env configuration; sign in using invented accounts. Never paste database secrets into chat or logs.
2. Register two separate fictional user accounts. Use the pre-approved offline operator-grant process to assign one account `support_reviewer` (time limit at most 90 days). Do not use a general/admin/self-issued role to triage.
3. User A submits `security_concern`. User B submits `privacy_deletion`, with **no description, identity document or other personal data**.
4. Confirm duplicate active category submissions are rejected. Confirm a user cannot read the operator queue or another requester's ticket.
5. The authorized reviewer opens **Test triage queue**. Confirm the P0 security simulation ranks ahead of P1 privacy.
6. Reviewer moves a security test case to `escalated` with `referred_security`, and a privacy test case to `reviewing` then `escalated` with `referred_privacy`; inappropriate disposition/state transitions fail.
7. Reviewer may return the privacy case to `reviewing` and mark it `closed_test`, then verify the audit trail. Never say this performed an actual privacy deletion.
8. Revoke the support role through the protected offline CLI. Confirm the same logged-in session immediately loses access to the triage queue.
9. Confirm zero actual Stripe calls, payment bookings, email/SMS deliveries, or sensitive documents were created by this drill.

## Incident-review checklist for a future real pilot (UNAPPROVED)
- Appoint the primary incident lead, backup, privacy contact, and on-call coverage, with verified contact methods.
- Determine how suspected security incidents are escalated *outside* the app if the app itself is compromised or unavailable.
- Commission a qualified security/privacy review of authentication, rate limits, key handling, access audit, backup/log access, and vulnerability response.
- Establish a counsel-approved breach-assessment workflow and statutory notice decision process (do not promise universal deadlines).
- Establish identity-verification procedures for real data-access, correction and deletion requests. Do not delete records solely because an unverified account selects `privacy_deletion`.
- Implement evidence intake redaction, ticket retention/deletion and role-based access for a **separate approved real-data environment**.
- Train and authorize actual support personnel; test availability and incident drills before any actual company signups or promises of response times.

## Test automation
`node --test test/preview-support.test.js test/provider-preview-ack-http.test.js`
with `ROUTEDROP_TEST_DATABASE_URL` pointing to a new disposable local PostgreSQL database. The integration test also exercises synthetic provider consent, credentials, independent launch approvals and the payment-disabled booking guard.

This test-only workflow is not a security certification or authorization to process actual privacy requests.
