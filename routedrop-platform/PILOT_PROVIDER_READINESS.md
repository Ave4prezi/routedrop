# RouteDrop founding-provider readiness — working gate (NOT launch approval)

Status: **SYNTHETIC TEST PREVIEW ONLY**. This is a working checklist for a future controlled founding-business pilot. It does not authorize actual provider identity intake, signed agreements, live bookings, charges, or public launch.

## What is implemented in the private preview

- Password-protected Render preview and fictional `example.test`, `example.invalid`, `ci.invalid` accounts only.
- Separate provider/reviewer authorization; reviewers cannot approve their own business.
- Draft provider category requirements and enrollment stages; verification/revocation/expiry checks in isolated tests.
- Encrypted test-document workflow with synthetic-only scanner bypass; mock malware scanner and mock evidence are **not safe for real IDs**.
- Versioned preview-only acknowledgement with exact published text + SHA256 stored in a separate PostgreSQL audit table at registration. Rejected or outdated versions do not create a user.
- **Code-only, not deployed:** a separate fictional launch approval is required after credential review; decisions can be revoked and expire after credential changes.
- **Code-only, not deployed:** time-limited, auditable operator permissions with offline DBA-controlled grants/revokes and separate credential/launch approvers.
- **Code-only, not deployed:** provider and restricted-reviewer in-app credential expiry reminders, with best-effort idempotent reminder records (no live outbound email).
- **Drafts, not approved policies:** `OPERATOR_ACCESS_RUNBOOK.md`, `CREDENTIAL_EXPIRY_RUNBOOK.md`, `PROVIDER_PRIVACY_NOTICE_DRAFT.md`, and `PILOT_SUPPORT_PLAYBOOK_DRAFT.md`.
- No live Stripe keys, no real charges, and no guarantee of paid jobs.

## Required controls BEFORE accepting real provider identities or documents

| Gate | Evidence required | Status |
| --- | --- | --- |
| Identity/privacy scope | Approved categories of personal data, lawful purposes, who can access it, and applicant notices | NOT APPROVED |
| Secure file intake | Isolated actual malware scanner and secure reviewer workstation; malicious-file and access tests | NOT APPROVED |
| Data life cycle | Approved retention/erasure windows, automatic cleanup, backups, access logs and breach escalation | NOT APPROVED |
| Encryption operations | Stored key management, monitored rotation and tested disaster recovery | NOT APPROVED |
| Legal/provider terms | Alabama counsel reviews provider agreement, consumer policy, cancellation/refund/complaint process and service-category licensing | NOT APPROVED |
| Compliance review | Independent security/privacy test of actual infrastructure and provider verification procedures | NOT APPROVED |
| Business eligibility | Independently verified licenses/insurance for applicable categories; manual escalation and expiry process | NOT APPROVED |
| Operations | Named support owner, backup incident responder, escalation hours, payment-reconciliation workflow | NOT APPROVED |
| Live pay after service | Real Stripe Connect onboarding and signed end-to-end payment/refund/charge-failure tests with approval | NOT APPROVED |
| Deployment | Private preview DB configured, fictional walkthrough complete, release review and explicit approval | NOT APPROVED |

No gate becomes approved because of a unit test, marketing copy, or checkbox alone.

## Proposed founding-partner onboarding journey

1. **Interest, not account collection:** explain purpose, service area and pilot availability without collecting documents or promising bookings. Use an approved, consent-based lead tracker before recording real contacts.
2. **Pilot invitation:** show exact draft fee model — no required monthly membership during early access; **8% of successful collected service payments**, paid by the provider, not an extra customer surcharge. Confirm any future changes explicitly.
3. **Legal agreement:** show lawyer-approved versioned terms and obtain recorded affirmative consent BEFORE accepting a real provider or payment activity.
4. **Identity and eligibility:** use a security-reviewed collection and verification service with category-specific credential checks. Do not upload real IDs, insurance policies, bank data or payment cards to the synthetic preview.
5. **Provider readiness:** verify business email, permitted service category, service area, price quote and Stripe Connect status; perform independent reviewer decision with audit record.
6. **Customer experience:** after published available slot is booked, customer securely saves a card via Stripe. The provider marks work complete; **customer separately confirms completion and authorizes the quoted charge**. Support handles declined payments/disputes; no surprise retries.
7. **Launch sign-off:** security, counsel, payments and support owners jointly approve the pilot before enabling any real bookings.

## Pilot operator decision record (fill in before launch)

- Pilot region/categories: **UNDECIDED**. Start with limited, low-risk categories after legal review.
- Pilot business cap / invite list: **UNDECIDED**.
- Real support and incident responder: **UNASSIGNED**.
- Customer complaint/refund contact channel and response timeframe: **UNDECIDED**.
- Document retention and erasure periods: **UNDECIDED**.
- Governing legal entity, agreement version, counsel approval: **UNDECIDED**.
- Hosting availability and Stripe webhook reliability release gate: **UNAPPROVED**; staging recovered from one observed cold start but Render Free may sleep.
- Go-live approver and date: **NONE**.

## Rollback rules

- Any failed eligibility gate blocks new payment-bearing bookings; do not disable verification to bypass it.
- Suspected breached document access: stop document intake, preserve incident metadata securely and engage counsel/security personnel.
- Webhook backlog, Stripe mismatch or disputed charge: pause new payment features and reconcile Stripe IDs read-only before any retries or refunds.
- Preview experiments must not be merged into the currently deployed staging branch or production without a separate review.

## Review artifacts

- `FOUNDING-PARTNER-PILOT.md`, `PROVIDER-VERIFICATION.md`, `PRIVATE-PREVIEW-SECURITY.md`: test-only prototypes.
- `DRAFT_PROVIDER_AGREEMENT.md`: proposed legal issues for attorney review, not published terms.
- `preview-acknowledgement.js`: **fictional-preview** acknowledgement only, not a binding agreement.
