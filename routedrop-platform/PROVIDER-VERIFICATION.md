# RouteDrop provider verification — staging pilot

## Scope and activation
This implementation is **staging-only, opt-in**. Set `ROUTEDROP_PROVIDER_VERIFICATION_ENABLED=true` only in a new disposable test environment after schema review; the flag also requires the existing deferred-booking sandbox mode. Running RouteDrop staging has **not** been changed or redeployed.

The feature defines category-dependent checks, an evidence reference/review workflow, a separate restricted reviewer role, and new-booking restrictions. The staging prototype now supports **encrypted PDF/PNG/JPEG evidence upload** (2 MB limit), restricted reviewer downloads and an in-app review queue. It does **not** automatically authenticate, OCR, validate, or legally certify identities, driver's licenses or insurance policies. Documents remain `pending` until explicitly reviewed. Reviewers with `deferred_support_agents` membership may inspect the queue and approve/reject documents, but cannot approve their own business. Never type personal ID numbers, policy numbers or sensitive information into free-text reference/review-note fields. Production deployment additionally requires malware scanning, independent privacy and security review, retention/deletion policy, key rotation design, and provider consent.

## Categories and obligations
- `identity` and `business_info` are required for all services.
- Driving services add `driver_license` and `auto_insurance`.
- Services with significant property, injury or care risk add `liability_insurance`.
- Selected regulated services add `professional_license`.
- Unknown, `Other` and specifically sensitive categories need a separate manual category review.
- All document/credential reviews are business-level records; listings are evaluated against the **listing's** category. Renewals and expirations immediately affect eligibility.
- Requirements are preliminary marketplace policy only, not a statement of Alabama law or a substitute for legal/insurance review. For higher-risk/regulated services confirm appropriate business/driver credentials and insurance coverage details with qualified professionals.

## API endpoints (enabled flag only)
| Route | Access | Purpose |
|---|---|---|
| `GET /api/provider-verification/categories` | Public preview | Draft category catalog |
| `GET /api/provider-verification/me` | Logged-in provider | Current verification requirements and status |
| `POST /api/provider-verification/submit` | Logged-in provider | Submit non-sensitive reference for review; resets status to pending |
| `GET /api/provider-verification/review-queue` | Restricted reviewer | See pending submissions |
| `POST /api/provider-verification/review` | Restricted reviewer | Approve/reject with reasons and expiry |
| `POST /api/provider-verification/category-decision` | Restricted reviewer | Approve an additional manual category policy review |

When enabled, the listing-discovery endpoint omits ineligible listings, and both upfront/legacy and deferred booking endpoints reject booking attempts for ineligible listings, including a second deferred-booking check inside the SQL transaction. Existing bookings and payments are **not** modified.

## Encrypted evidence prototype

- Set **ROUTEDROP_PROVIDER_DOC_KEY_B64** to a cryptographically random, 32-byte base64-encoded key in a **disposable staging environment's secret store**. Never commit this key, copy a production key into tests, or send it through chat.
- All evidence is encrypted with **AES-256-GCM** before storage in PostgreSQL BYTEA, with unique nonces and associated data binding the ciphertext to its business ID and credential type. Key is separate from the database credentials. No plaintext files are stored on the application disk by this feature.
- Accepted file signatures: PDF (with EOF trailer), PNG (signature and IEND), or JPEG (start/end markers). **This is not antivirus scanning or full file-content verification**; do not treat file acceptance as sufficient to safely open documents in production.
- \`POST /api/provider-verification/document\` accepts \`application/octet-stream\` with an \`x-evidence-kind\` header. It requires an authenticated provider, is CSRF/origin protected by RouteDrop's existing middleware, and always resets the credential to \`pending\` upon replacement.
- \`GET /api/provider-verification/review-document/:businessId/:kind\` is authorized to existing restricted support reviewers only; downloads use attachment disposition and no-store response headers. Document downloads, submissions, removals, reviews and revocations create audit entries.
- \`DELETE /api/provider-verification/document/:kind\` lets the owning provider remove the active encrypted evidence and revokes its approval. Logical deletion does **not** necessarily purge database backups or storage replicas.
- Credentials cannot be approved without an encrypted evidence upload, except a non-sensitive business-information reference that a reviewer independently verifies. Rejected credentials may be resubmitted. Approved credentials with expired dates automatically fail booking eligibility checks.
- \`POST /api/provider-verification/revoke\` lets an authorized independent reviewer revoke a credential. For regulated service categories, further category policy review is required.
- The **Provider reviews** operator interface appears only for authorized support accounts; the **Submit document for review** interface appears for logged-in providers when verification is enabled.

**Limitations:** Encryption key rotation, automated expiry reminders, evidence malware scanning and validation, retention/erasure (including backups), reviewers' secure workstations, document-type constraints, and legal/compliance sign-off are still pending. The prototype must **not** be enabled with real customer/provider identity documents until these controls have been implemented and reviewed.

## Required before activation
1. Verify migration and review/booking workflows using a disposable staging database and Stripe test keys only.
2. Obtain Alabama legal advice on which categories require actual licensing and specific insurance limits; restrict categories not yet cleared for operation.
3. Conduct an independent security review of encrypted evidence handling, provider-facing upload and reviewer UI; add malware scanning, key rotation, retention and erasure controls before sensitive real documents.
4. Decide whether a single operator may review their own business; **current policy forbids it**. No bypass role exists.
5. Review revocation and audit logs, add category-approval revocation, expiry reminders and user appeal flows.
6. Test concurrent booking and expiry updates against PostgreSQL. Confirm all booking entry points share server-side eligibility enforcement.
7. Confirm what can be publicly claimed; never say RouteDrop has verified a provider unless it actually reviewed the relevant evidence.
8. Review consent/privacy policy, data retention, and any applicable background-check laws before collecting sensitive information.

## Operations
A provider can still register and draft listings during an early-access pilot. Only booking eligible listings is allowed once enforcement is on. Do not enable enforcement on the currently running staging instance before approving the migration and testing the transition: it would hide existing unverified listings and prevent new test bookings.
