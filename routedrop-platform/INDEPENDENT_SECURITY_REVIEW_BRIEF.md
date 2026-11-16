# RouteDrop: independent security review briefing (confidential internal handoff)

**Status: OPEN / NOT ASSESSED.** Prepared from repository code and connector-visible Render service metadata on 2026-11-15/16. This document is an inventory and assessment request; it is **not** an independent audit, certification, vendor approval or penetration-test result. Never publish credentials, payment records, signed webhook secrets, evidence files or live PII in this packet.

## 1. Proposed scope and boundary

| Component | Evidence inspected | Scope restriction |
| --- | --- | --- |
| Express app | `routedrop-platform/server.js` | Authentication/session/CSRF, startup guards, role enforcement, APIs |
| Basic preview access | `staging-access.js` | Private gate, minimum password, exceptions for health and signed webhooks |
| Document controls | `provider-evidence.js`, `document-security.js` | Synthetic-only uploads, encryption, key rotation, retention, mock/real ClamAV behavior |
| Provider checks | `provider-verification.js`, `provider-launch-approval.js`, `provider-expiry.js` | Category-specific review, independent launch approval, stale and expired credentials |
| Operator permissions | `operator-access.js`, offline scripts | DBA-initialized, expiring access; role separation, audit, revocation |
| Support simulation | `preview-support.js` | Fixed-category, minimum-data tickets, role checks and audit |
| Payments | `post-service.js`, `payment-safeguards.js`, Stripe | **TEST only**; customer approval, reconciliation, refunds, webhooks must receive separate real-payment assessment |
| Hosting | Render, Neon, GitHub Actions, Stripe TEST | Review service-account IAM, databases, backups, networks, webhook destinations, CI token permissions |

**Hosting observation, not runtime connectivity proof:** Render private provider preview `routedrop-provider-private-preview-av` is on branch `security/private-provider-preview-20261107`, Render Free, auto-deploy off. It is **not** running this current stacked development code. Its prior repository readiness note says the separate Neon preview DB URL still needs secure connection; verify independently before claiming the preview is interactive. No database passwords, Stripe keys or personal data are included in this packet.

## 2. Explicit threat model

Assets: fictional preview roles, audit trail, document encryption keys, test evidence, ordinary app sessions, non-preview booking/payment integrity.

Threats and independent reviewer work:
1. **Configuration drift / unintended real onboarding:** verify malformed or partial fictional-preview flags cannot silently disable the private gate or turn on regular registration. `preview-startup-policy.js` now rejects unsafe preview intent before app listening; confirm with deployment-equivalent env tests.
2. **Operator privilege escalation:** verify role bootstrap, SQL role grants, session invalidation, separation of credential and launch approvers, support self-review, and race conditions in permission changes. Offline DB administrator access is a privileged boundary and needs separate controls.
3. **Document upload abuse:** challenge PDF/image validation, size constraints, ClamAV protocol, scanner network isolation, bypass conditions, malicious archives, embedded actions and untrusted metadata. The synthetic preview can intentionally bypass real malware scanning for **fake files only**.
4. **Data exposure:** test broken access control across accounts/roles, hidden credential content, reviewer downloads, logs, browser cache, backup access, stored file keys and audit retention.
5. **Booking/payment integrity:** check that no invalid provider/listing can be newly booked and that post-service payment requires customer approval. Verify Stripe event destination logs and refund/replay/deduplication for **TEST only** before any live release.
6. **Availability and messaging:** test Render Free sleep/cold-start, real cron/durable reminder delivery requirements, email provider rate limits and multi-destination webhook behavior; do not equate one successful test with a reliability guarantee.
7. **Incident and data-rights handling:** conduct tabletop with independent staff, known privacy/security contacts, legally reviewed notice pathways and evidence preservation.

## 3. Current controls versus remaining gaps

**Implemented in isolated code, not deployed to the hosted private preview:** fictional-only signup, immutable-version test consent, credential reviews, separate category launch review, audited expiring operator permissions, in-app credential expiry warnings, fixed-category fictional support triage, and new pre-listen preview-config guard. Evidence: unit and disposable-Postgres HTTP tests in `test/`; GitHub Actions CI receipts in PRs #38–#41 and this review PR.

**Unapproved and unverified:** a real malware-scanner service; scanner availability/alerts; independent application/infra penetration testing; cloud IAM, backup restoration and key rotation on production-like infrastructure; retention and right-to-deletion schedules; actual legal credential authenticity checks; live Stripe Connect and notice compliance; staffed response contacts; hosting uptime target; and real launch sign-off.

## 4. Verification checklist for an external assessor

- [ ] Confirm app and preview configuration from **actual** Render env without exposing secrets in review records.
- [ ] Confirm actual database/branch isolation and no shared real booking or user records.
- [ ] Prove HTTP private preview cannot be reached without its password except explicitly documented endpoints.
- [ ] Prove no TEST, LIVE or restricted Stripe keys exist in this synthetic preview.
- [ ] Authenticate as each least-privilege role; test cross-tenant/role access, self-review, revocation, credential expiry, CSRF, session replay and password reset.
- [ ] Validate MIME/file contents, scanner behavior, encryption, recovery, deletion, logs and backlog.
- [ ] Review dependency inventory, CI permissions, secret exposure, secure headers and external services.
- [ ] Perform documented threat-model exercises and retest findings after remediation.
- [ ] Issue a dated signed report with scope, severity, reproduction steps, owners, fixes and remaining risk.
- [ ] Explicitly approve or refuse controlled real-data pilot release; **do not** claim code/tests alone authorize it.

## 5. Release criteria

No real-provider ID or insurance intake, real business invitation for document upload, live bookings, or live charges while any blocking assessment is open. Owner must record who approves each control, evidence, expiration/review date, and rollback owner in `PRELAUNCH_DECISION_REGISTER.md`.

Security references used as independent-review guidance:
- OWASP ASVS 5.0: https://github.com/OWASP/ASVS
- OWASP Session Management: https://github.com/OWASP/ASVS/blob/master/5.0/en/0x16-V7-Session-Management.md
- FTC Business Data Breach Response: https://www.ftc.gov/business-guidance/resources/data-breach-response-guide-business

**No actual independent penetration test has been commissioned or completed by generating this brief.**
