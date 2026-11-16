# RouteDrop operator access runbook — private synthetic preview

**NOT A PRODUCTION ACCESS APPROVAL.** Applies solely to the no-payment, invented-identity provider preview. No real provider documents, IDs, insurance records or customer funds may be processed under this workflow.

## Roles and separation of duties

| Role | Can do | Cannot do |
| --- | --- | --- |
| `credential_reviewer` | Review fictional sample documents, eligibility and 30-day expiry queue | Grant permissions, approve launch, access another operator's permissions |
| `launch_approver` | Review and revoke fictional category-specific listing launch decisions | Review documents, grant roles, self-approve owned business |
| `support_reviewer` | Reserved for restricted fictional support scenarios | Grant roles, approve providers, authorize live payment actions |
| Administrator (DBA-appointed) | Execute approved **offline** role grant/revoke transactions | Self-grant, use public HTTP for role changes, authorize real launch |

Credential and launch roles must be different accounts. Launch approval of an account owned by the operator is denied even if the operator has a role. No public API permits role grants.

## One-time administrator bootstrap

A privileged DBA, **not the app**, must create the first admin in `provider_operator_admins` on a **disposable synthetic preview database only** after independently checking the account and recording a two-person change approval/ticket ID in `appointment_reason`. The bootstrap requires a separate manual ticket and should never be invoked from a customer-facing route.

DBAs with unrestricted database rights can bypass application role checks; protect and audit those database credentials independently. This preview is NOT independently security-audited.

## Everyday grant/revoke

1. Require a recorded operator request with role, business justification, approver and expiration. The target must use an invented `example.test` / `example.invalid` / `ci.invalid` email in this preview.
2. Use a dedicated privileged workstation/secret manager. Do not paste `DATABASE_URL` into chat, scripts, GitHub, commits, tickets or logs. Give database accounts only required access and use MFA for cloud account access.
3. Set the CLI's protected runtime environment: `ROUTEDROP_PRIVATE_PREVIEW_ONLY=true`, `ROUTEDROP_STAGING_LOCK=true`, `ROUTEDROP_PROVIDER_DOCS_MODE=synthetic`, `ROUTEDROP_LIVE_APPROVED=false`, no `STRIPE_SECRET_KEY`, `DATABASE_URL` sourced from the secret store, `ROUTEDROP_OPERATOR_CHANGE_ACK=FICTIONAL_PREVIEW_APPROVED`.
4. Run from `routedrop-platform`, with shell-escaped arguments:

   `node scripts/manage-preview-operator.js grant admin@ci.invalid reviewer@ci.invalid credential_reviewer 2026-12-15T00:00:00Z "Approved synthetic-only reviewer assignment for ticket T-001"`

   Revoke: `node scripts/manage-preview-operator.js revoke admin@ci.invalid reviewer@ci.invalid credential_reviewer - "Operator access revoked following synthetic test completion"`

5. Confirm the row in `provider_operator_audit`; verify the target can only access its assigned review queue. Grants expire within 90 days and are checked for every protected request.
6. On departure, role change, or suspected compromised credential, revoke immediately, invalidate sessions through the separate account-session process, rotate relevant infrastructure credentials, and preserve audit history.

**No public operator role grant endpoint, no default administrator, and no permanent implicit role.** Adding a real production operator workflow would require SSO/MFA, scoped DBA privileges, independent review, signed security approval and operational training.

## Recurring audit

- Weekly: compare grant and audit tables to an independently approved operator roster.
- Daily when an operator works: check for revoked/expired roles and outstanding provider decisions.
- Quarterly: review least-privilege role catalog, reviewer independence and account deprovisioning.

These are proposed operational procedures, not automated guarantees. Assign accountable staff before live onboarding.
