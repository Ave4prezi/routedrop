# RouteDrop provider and customer support — OPERATOR PLAYBOOK DRAFT

**NOT ACTIVE CUSTOMER SUPPORT POLICY.** A separate `SYNTHETIC_SUPPORT_TRIAGE_RUNBOOK.md` now describes a code-only, fictional test-ticket queue with role-restricted audit; it cannot receive real incidents or exercise data rights. Do not publish a response SLA, give a support address that has not been verified, or invite real customers/businesses until the owner, backup and contact channels are assigned and tested. Existing Stripe payments remain TEST-only.

## Operator-selected support hours (not yet published or verified)

- **Monday–Friday, 9:00 AM–5:00 PM America/Chicago (Central Time, observing daylight saving time).**
- Primary support and backup have accepted their roles; identities and the proposed shared mailbox are kept in a separate confidential roster, not this public repository.
- The operator reports both contacts accepted support/incident roles and a harmless email reply and direct call/return call were successfully tested. Actual support staffing, mailbox ownership authorization, RouteDrop folder access segregation, primary-unavailable failover, independent security responder, response expectations, and privacy contact still require testing and sign-off. **These hours are a selected operating schedule, not a live support service or guaranteed response SLA.**

## Proposed ticket fields (minimum necessary)

Incident ID, received date/time, requester role and verified account reference, affected listing/booking/reference IDs, type, severity, current owner, timestamps, action history and resolution. Never place payment card numbers, driver's license images, full policy numbers or passwords in support notes. Restrict attachments and redact before sharing.

## Triage and proposed escalation

| Priority | Examples | Proposed handling (NOT committed SLA) |
| --- | --- | --- |
| P0 — Safety/security/payment integrity | Exposed real documents, account takeover, Stripe mismatch/duplicate charge, unauthorized operator access | Stop relevant intake/changes; page designated primary + backup as soon as detected; preserve evidence and consult counsel/security/Stripe |
| P1 — Booking or provider eligibility blocked | Expired insurance/license, inaccessible account, disputed completed job | Confirm provider/account ownership; check eligibility/Stripe state read-only; escalate to appropriate independent reviewer |
| P2 — Routine enrollment and platform help | Fictional onboarding questions, profile corrections, listing edits | Use documented FAQ, verify actions, log result and follow-up |
| P3 — Feature requests | Category suggestions, improvements | Collect no unnecessary personal information; plan separately |

Assign actual owners and supported hours before claiming response targets.

## Intake workflow

1. Verify requester's authority with normal account authentication, not identity-document email attachments.
2. Identify whether question concerns provider verification, booking, refund, disputed job, safety incident, privacy request or platform malfunction.
3. Review only the minimal permitted records; do not download raw credentials unless explicitly needed and authorized.
4. For payment/refund incidents, compare amount, Stripe mode, PaymentIntent/session/refund IDs, destination and event receipts **before** changing state. A webhook HTTP 200 is not necessarily proof that every destination has processed the event.
5. For completed work, customer must separately confirm the quoted amount before the post-service charge. Do not secretly re-charge, retry failed off-session transactions, refund twice or resolve disputed jobs solely from provider claims.
6. For credential issues, escalate to an independent credential reviewer; for fictional listing eligibility, separately designated launch approver decides. Never approve a provider's own documents/launch.
7. Record action reason, follow-up date and closure evidence. Reopen if a user disputes facts or new evidence appears.

## Cancellations, refunds and disputes — draft

- Existing sandbox logic has a 24-hour cancellation and refund-review concept. **It is not an approved live policy.**
- The future customer-facing policy must specify no-shows, cancellations, partial vs full refunds, who decides, complaint route, fees, chargeback handling and potential reversal of Stripe transfers/platform fees.
- Treat Stripe payments as authoritative for settled and refunded amounts; do not trust only local UI status.
- Avoid duplicate refund/charge calls following timeouts until the idempotency key and Stripe object have been checked.

## Privacy and security request routing

- Access/correction/deletion requests: document minimum identifiers and refer to the designated privacy contact (currently UNASSIGNED).
- Suspected exposure: treat as P0, revoke role access, preserve logs, stop intake and consult counsel for statutory notice assessment.
- Never ask a provider to send real IDs or insurance policies to the synthetic test portal or ordinary email.

## Sample non-binding replies (not for sending until channels approved)

**Enrollment:** "Thanks for your interest in RouteDrop. Our founding-business pilot is not yet accepting real identity documents or payments. We can explain our proposed terms and contact you after the onboarding process is approved, with your consent."

**Upcoming expiry (fictional preview only):** "A test credential linked to your simulated service category is approaching its recorded expiration. Replace it using fictional evidence in the private preview; independent review and renewed launch approval are required."

**Booking dispute:** "Your report is being reviewed. We will verify the booking and payment records before deciding next steps. We will not attempt a duplicate payment or refund while the status is uncertain."

## Before real pilot

- [x] Designate primary and backup support contacts (identity held privately; backup acceptance verbally reported)
- [x] Designate internal primary and backup incident first contacts (identities privately held; phone call/return call verified by operator)
- [ ] Complete the fictional primary-unavailable and backup escalation exercise in `AFTER_HOURS_SECURITY_FAILOVER_DRILL.md` and verify the independent failover route
- [ ] Engage a qualified external security incident responder and agree escalation terms
- [ ] Verify support coverage/handoff for Monday–Friday 9 AM–5 PM Central and define after-hours escalation
- [ ] Configure and test help/privacy/security contact channels, hours and handoff procedures
- [ ] Approve actual customer cancellation/refund and provider appeals language
- [ ] Establish ticketing with access restrictions and tested retention/deletion rules
- [ ] Run refund, payment-failure, disputed service, expired credential and lost access drills using fictional accounts
- [ ] Sign off on the escalation path and emergency stop controls
- [ ] Obtain legal, privacy/security and release approvals

No real business invitation should imply that these procedures are already staffed or activated.
