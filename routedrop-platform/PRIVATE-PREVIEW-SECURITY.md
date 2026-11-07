# RouteDrop private provider preview — security status

## Isolated environment

Render service: routedrop-provider-private-preview-av
Code branch: security/private-provider-preview-20261107
Neon project: routedrop-synthetic-preview-20261107
Neon database: routedrop_preview

The preview is protected by a strong HTTP Basic password (username: routedrop-staging) and HTTPS. Automatic deploy is disabled. It does not contain any existing staging bookings or user records. It has no Stripe key and cannot process payments.

**Connection step still needed:** The user must place the NEW Neon database URL into the preview Render service's DATABASE_URL environment setting using their secure account dashboards. Direct credential movement between these connectors was unavailable; do not copy secrets into repository files or chat messages. Until connected, the private preview can only show its read-only interface.

## Security controls verified by automated tests

- **No live payment acceptance:** Private preview requires staging lock, synthetic-only mode, no Stripe secret and explicit verification opt-in.
- **Fictional accounts only:** Signup rejects real email domains; permitted sample domains are example.test, example.invalid and ci.invalid. Never enter real identities, actual driver's licenses, insurance certificates or customer payment cards.
- **Authorization:** Provider ownership is checked before upload or removal; restricted separate reviewers may download or approve evidence; self-approval is prohibited.
- **Encryption:** AES-256-GCM with per-file nonces, authenticated business/category binding, versioned key IDs and a keyring for rollover.
- **File acceptance:** 2 MB maximum, PDF/JPEG/PNG signatures, and detection of known active PDF actions.
- **Malware scanning gate:** Real-document intake requires an accessible private ClamAV INSTREAM scanner. Absent, rejected, malformed or timed-out scan results fail closed. The synthetic preview intentionally bypasses scanner checks ONLY for fictional test files.
- **Rate limiting:** General API controls and a dedicated upload limiter.
- **Audit:** Document upload, download, removal, approval, revocation and maintenance summary events.
- **Retention:** A manually invoked, transaction-safe helper prunes stale pending/rejected documents and evidence for long-expired credentials; it is not scheduled.
- **Key rotation:** A transaction-safe helper re-encrypts documents onto the active versioned key and preserves readability using old keys until migration.
- **Expiry:** Expired/revoked mandatory credentials block new bookings.

These controls have automated tests, including disposable PostgreSQL. They do not constitute an independent penetration test, legal credential validation or a full deployment audit.

## Unresolved checks that block real document intake

1. Deploy and test an actual malware-scanner service on a private network. Current coverage uses a mock ClamAV endpoint; no real scanner is provisioned.
2. Complete an independent security and privacy assessment, including malicious file parsing, reviewer access, cloud IAM, application dependency vulnerabilities and audit retention.
3. Approve the real-world retention schedule and run the cleanup job automatically; test that backup recovery and deletion windows comply with the policy.
4. Rehearse encryption key rotation and disaster recovery with real infrastructure, preserving previous keys until backups expire.
5. Establish licensed-service requirements, insurance authenticity checks, policy notices, legal provider agreement, appeal/reverification processes and expiration reminders.
6. Connect the isolated preview database through the account's secret-management interface and complete a browser-based walkthrough using fictional accounts.
7. Do not activate real provider onboarding or payments until these requirements have a separate go-live review.

**Decision: SYNTHETIC PREVIEW ONLY — REAL DOCUMENTS AND LIVE PAYMENTS NOT AUTHORIZED.**
