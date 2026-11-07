# RouteDrop provider verification — staging pilot

## Scope and activation
This implementation is **staging-only, opt-in**. Set `ROUTEDROP_PROVIDER_VERIFICATION_ENABLED=true` only in a new disposable test environment after schema review; the flag also requires the existing deferred-booking sandbox mode. Running RouteDrop staging has **not** been changed or redeployed.

The feature defines category-dependent checks, an evidence reference/review workflow, a separate restricted reviewer role, and new-booking restrictions. It does **not** upload, authenticate, OCR, or verify government IDs, driver's licenses or insurance policies automatically; do not label a provider as verified merely because they submitted a reference. Provider submissions are `pending` until a reviewer accepts. Reviewers with `deferred_support_agents` membership may inspect the queue and approve/reject documents. Reviewers cannot approve their own business. No personal ID numbers, addresses, license scans or policy numbers should be typed into the reference field. A separately designed encrypted document storage/review workflow and deletion controls are required before processing sensitive identity records.

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

## Required before activation
1. Verify migration and review/booking workflows using a disposable staging database and Stripe test keys only.
2. Obtain Alabama legal advice on which categories require actual licensing and specific insurance limits; restrict categories not yet cleared for operation.
3. Implement a secure evidence collection mechanism and reviewer-facing UX; until then the reference field is only an intake placeholder.
4. Decide whether a single operator may review their own business; **current policy forbids it**. No bypass role exists.
5. Provide a way to revoke credentials/category approvals, document audit logs, expiry reminders and user appeal flows.
6. Test concurrent booking and expiry updates against PostgreSQL. Confirm all booking entry points share server-side eligibility enforcement.
7. Confirm what can be publicly claimed; never say RouteDrop has verified a provider unless it actually reviewed the relevant evidence.
8. Review consent/privacy policy, data retention, and any applicable background-check laws before collecting sensitive information.

## Operations
A provider can still register and draft listings during an early-access pilot. Only booking eligible listings is allowed once enforcement is on. Do not enable enforcement on the currently running staging instance before approving the migration and testing the transition: it would hide existing unverified listings and prevent new test bookings.
