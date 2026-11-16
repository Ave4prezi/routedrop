# RouteDrop fictional-provider launch approval gate

**Status:** Development-only. No real provider, payment, credential or public launch authorization. This feature exists solely on a private synthetic-preview test branch and must **not** be enabled on running staging or production by default.

## Why this gate exists

Document approval alone is insufficient to publish a business's service openings. The private preview requires **two separate decisions**:

1. Document reviewer verifies invented PDF/PNG/JPEG evidence against the draft requirements for the **listing's category**.
2. A separately designated launch approver reviews the provider and category, then decides whether the **fictional preview listing** may appear.

This prevents an unreviewed business from being advertised merely because its documents were uploaded or a credential reviewer marked them approved.

## Conditions for the synthetic preview

Activation is automatic **only if** all of these existing conditions are true:

- `ROUTEDROP_PRIVATE_PREVIEW_ONLY=true`
- `ROUTEDROP_STAGING_LOCK=true`
- `ROUTEDROP_PROVIDER_DOCS_MODE=synthetic`
- `ROUTEDROP_PROVIDER_VERIFICATION_ENABLED=true`
- No Stripe secret key and no live-payment approval.

A real staging beta or production environment never enables this gate through this code path. The synthetic preview is already protected by HTTPS/Basic authentication and fabricated account email domains; this new gate is additional protection, **not a substitute for other safeguards**.

## Reviewer roles and decisions

- Credential reviewers are explicitly designated in `provider_document_reviewers`; credential approval does **not** grant launch approval.
- Launch approvers are separately designated in `provider_launch_approvers`. These role grants have no public signup/API. Never grant them to general users.
- A reviewer cannot approve their own business, even if they also hold the launch-approver role.
- An approver may approve **only a real draft listing category** for a business whose required credentials are currently reviewed and valid.
- A decision requires a reason of 15–500 characters, without private documents or ID numbers.
- `POST /api/provider-launch/decision` records approval or revocation and an audit entry in the same database statement.
- `GET /api/provider-launch/queue` is restricted to launch approvers and shows provider/category readiness and current synthetic decision.

## Fail-closed behaviors

- No launch-decision row => listing hidden.
- Revoked decision => listing hidden immediately.
- Missing, rejected or expired required credential => hidden, even if previously approved.
- Credential or relevant manual category-review records changed **after** the decision => approval stale; listing hidden until a new independent decision.
- Approval is **per listing category**, not a blanket business certification.
- Eligibility is rechecked on discovery and both booking creation paths when the applicable verification feature is enabled.
- No real payment features are activated. In the private preview, Stripe is deliberately unconfigured, so a fictional listing cannot become a paid booking.

## Test evidence

Run `test/provider-preview-ack-http.test.js` with `ROUTEDROP_TEST_DATABASE_URL` set to a **disposable local test database**. It boots the actual RouteDrop HTTP service with invented users and sample evidence and checks: no credential approval, credential-only, unauthorized launch, owner self-approval, explicit approval, revocation, stale credential update, renewed approval and denied checkout. It also queries the audit table and confirms zero payment bookings.

Existing `test/founding-partner-http.test.js` continues verifying the separate staging-only credential process; it is **not** retroactively put behind this private-preview-only launch gate.

## Outstanding before any real launch

- Identify and verify the real legal/operator entity.
- Independent legal/privacy/security review, including category-specific licensed activities and insurance requirements.
- Actual malware scanner, independent credential authenticity checks and reviewed retention/deletion/key-rotation processes.
- Secure role provisioning, multi-person approval policies, credential expiry alerts, appeal process and incident response.
- Live Stripe Connect verification, operational payment monitoring, customer communication, and explicit release sign-off.
- Separate migration/testing before deciding whether any similar gate should protect a paid pilot.

**A synthetic approval is never a substitute for real-world provider verification or launch authorization.**
