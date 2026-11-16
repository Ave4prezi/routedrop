# RouteDrop hosted identity + moderator passkeys — private staging guide

**Status: integrated code only, credentials not connected.** The public RouteDrop website and existing password-protected visual preview must not be modified for this setup. The functional pilot remains payment-disabled.

## Current private-staging checkpoint — 2026-11-16

- A separate PostgreSQL-backed Render staging service is running on the isolated identity/passkeys branch. Automatic deployments remain disabled; changes require deliberate testing and deployment.
- A Stripe Identity **sandbox Dashboard** document + selfie verification was created and completed using Stripe's **simulated success** test option. This proves the Dashboard test flow, **not** RouteDrop's API integration, signing-secret delivery, or webhook receipt.
- Stripe's account verification documents are under review. The restricted-key permission screen did not show Identity or Verification Sessions. **Do not substitute an unrelated permission or live Stripe secret.** Provider verification remains disabled until a correctly scoped TEST credential and webhook signing secret are present and checked.
- The Business Studio has a provider setup checklist that reads existing authenticated screening and Identity status endpoints. It explicitly labels all results as private-test outcomes, and leaves customer payments off.
- Moderator passkey enrollment and authentication remain disabled until an authorized test moderator, dedicated private bootstrap key, and passkey device are ready. Do not create a moderation bypass to compensate for missing credentials.

**Resume conditions:** Complete Stripe account review, confirm Identity test API permissions with Stripe if still missing, configure a dedicated TEST-only API key and signature secret securely in staging, validate real TEST-mode webhook deliveries, then separately test passkey enrollment and authentication. No production merge is authorized by this checkpoint.

## Stripe Identity (TEST only)

1. Enable **Stripe Identity** for a Stripe account under its terms and applicable requirements. Use its test environment with fictitious test material only; never ask the user to paste Stripe keys or real identity documents into chat.
2. Configure a **separate, least-privilege Stripe TEST secret/restricted key** capable of creating Identity VerificationSessions (and retrieving those sessions if required), not the ordinary payments `STRIPE_SECRET_KEY`.
3. Create an Identity-only webhook endpoint in Stripe TEST mode: `https://YOUR-ISOLATED-STAGING-HOST/api/pilot/identity/webhook`. Select `identity.verification_session.verified`, `identity.verification_session.requires_input`, `identity.verification_session.processing`, `identity.verification_session.canceled`.
4. In a **separate database-connected staging Render web service**, configure these secret variables through Render's Environment page:
   - `DATABASE_URL` — a **dedicated staging PostgreSQL URL**, never a production/EmpowerBands DB.
   - `ROUTEDROP_WORKFLOW_PILOT=true`
   - `ROUTEDROP_PREVIEW_ACCESS_PASSWORD` — strong and private.
   - `ROUTEDROP_LIVE_APPROVED=false`; leave **all regular payment Stripe keys unset**.
   - `PUBLIC_URL=https://YOUR-ISOLATED-STAGING-HOST`
   - `ROUTEDROP_IDENTITY_TEST_ENABLED=true`
   - `ROUTEDROP_STRIPE_IDENTITY_TEST_KEY` — TEST secret/restricted key, never live.
   - `ROUTEDROP_STRIPE_IDENTITY_WEBHOOK_SECRET` — the TEST listener's `whsec_...` signing secret.
5. A provider with an **email-verified** RouteDrop account explicitly consents and starts a hosted Stripe verification session. Browser navigates to Stripe's short-lived HTTPS URL; ID/selfie material is collected **by Stripe** and is never uploaded to RouteDrop. RouteDrop stores only provider ID, opaque session ID, outcome, consent timestamp and idempotency data. The signed webhook, not the redirect, is authoritative. Only known sessions with valid TEST-mode event and status are processed, with replay deduplication and status-regression protection.
6. `verified_test` is **not** a real identity approval; `identity_verified=false` and no public badge or permission for real work remain enforced.
7. Identity testing does not verify business registration, professional licensing, insurance or suitability for regulated service categories. A real release requires legal/privacy approval, vendor due diligence, access/retention policies, category rules and explicit authorization. Live identity credentials are deliberately rejected by this pilot's integration.

## Phishing-resistant moderator authentication

1. Use a **dedicated HTTPS staging hostname** for the functional pilot; WebAuthn passkeys are bound to the exact host and origin.
2. Set securely, in that staging web service:
   - `ROUTEDROP_MODERATOR_EMAILS` — comma-separated email addresses of authorized **email-verified** moderator accounts.
   - `ROUTEDROP_MODERATION_TOKEN` — distinct cryptographically random secret (32+ characters), **never** reuse the preview password.
   - `ROUTEDROP_MODERATOR_PASSKEYS_ENABLED=true`
   - `ROUTEDROP_WEBAUTHN_ORIGIN=https://YOUR-ISOLATED-STAGING-HOST`
   - `ROUTEDROP_WEBAUTHN_RP_ID=YOUR-ISOLATED-STAGING-HOST` (hostname, no scheme/path/port).
3. Enable `ROUTEDROP_MODERATOR_ENROLLMENT_ENABLED=true` **temporarily** for an approved setup session only. An allowlisted, signed-in, verified moderator enters the separate moderator key and registers a passkey using device user verification (fingerprint/PIN/security key).
4. After enrollment, set `ROUTEDROP_MODERATOR_ENROLLMENT_ENABLED=false` again. A moderator must authenticate their passkey before every short **10-minute** authorization window. Changes and decisions remain logged and may still require a rationale. The passkey challenge is scoped to the login session, expires after 3 minutes, is consumed once, and credentials are verified server-side with counter updates. Signing out/password changes invalidate session-bound step-up state.
5. Plan enrollment of at least two authenticators, verified account recovery, explicit revocation and stronger break-glass procedures before real operators use it. Never send moderator keys, passkey material or recovery secrets in a message.

## CI / current limitations

- Unit tests: test-mode identity key and webhook-event constraints, URL and origin constraints, WebAuthn challenge generation, session expiry / authorization, existing price/review/booking regressions.
- Database integration: runs with **no Stripe Identity key**, verifies that identity is disabled and privileged moderation fails without passkey step-up. The test suite uses a direct *privileged CI fixture* representing an already-authenticated moderator to exercise downstream authorization; this is not available to external users or production.
- **Not yet end-to-end verified with a real Stripe test account or a physical/virtual WebAuthn authenticator.** Do not claim external identity checks have been completed until separately verified with the configured vendor and approved test devices.
- No production merge, real applicants/customers, Stripe payment activation, personal ID collection in RouteDrop, or live identity/verified badges are authorized.

References: [Stripe Identity](https://docs.stripe.com/identity), [SimpleWebAuthn v13 server docs](https://simplewebauthn.dev/docs/13.3.x/packages/server), [NIST SP 800-63A-4](https://pages.nist.gov/800-63-4/sp800-63a.html).
