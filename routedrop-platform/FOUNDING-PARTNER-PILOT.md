# RouteDrop founding-business onboarding pilot

**Status:** isolated, fictional-data testing only. Not publicly deployed or approved for sensitive document collection or real payments.

## Partner-facing positioning

**RouteDrop — Find local services. Book now. Pay after the job.**

Businesses can express interest across supported service categories. RouteDrop's introductory platform commission is **8% of successfully collected service payments**. There is **no required monthly membership during early access**. No successful live payment or guaranteed job volume is promised by joining the pilot.

## Partner experience in order

1. **Choose "Become a founding business".** This selects a business account and presents the early-access acknowledgement.
2. **Register:** name, email, unique password, business name, operating city and primary service category. RouteDrop records acknowledgement in the registration request while verification mode is active; a versioned, retained provider-agreement acceptance system is still needed before real transactions.
3. **See Business Studio:** a five-stage onboarding checklist covers business registration, verification, Stripe payout setup, listing and launch approval.
4. **Draft a service listing:** enter title, category (42 supported options), neighborhood, quoted service price and available time.
5. **Submit fictional testing evidence:** only in a dedicated isolated non-production environment. Required checks vary by listing category. Allowed sample formats: PDF, PNG and JPEG, maximum 2 MB. **Never invite real partners to upload actual driver's licenses, policy documents or IDs to this prototype.**
6. **Reviewer evaluation:** a separate authorized reviewer examines fictional evidence, approves/rejects with an audit note and expiration date where required. Providers cannot review their own businesses.
7. **Eligibility:** listings become discoverable only when required checks for their service category pass. A revocation or expired credential prevents new bookings. This is NOT a promise of regulatory compliance or a legal credential verification service.
8. **Production launch gate:** Stripe Connect live-account requirements, actual verified documents, terms, risk review, launch approval and real booking/payment testing remain separate tasks. No public payment bookings until explicitly authorized.

## Business visit checklist

- Ask about the company's services, normal price range and service area.
- Explain the 8% fee and pay-after-service customer confirmation; clarify that the pilot is not yet accepting live payments.
- Confirm the business is interested in early access. Do not promise immediate sales or a go-live date.
- Ask whether the business provides transportation, on-site work, childcare, care services or regulated trades so extra requirements can be scoped.
- Record interest with the business's consent using an approved lead tracker (not an unsanctioned Google Sheet or sensitive document upload).
- Invite businesses to test the demo only with fictional sample information until onboarding and privacy safeguards are signed off.

## Test coverage

The executable \`test/founding-partner-http.test.js\` starts the **actual RouteDrop HTTP application** connected only to a brand-new disposable PostgreSQL schema. It supplies fake business and reviewer accounts, fake PDF evidence, and a deliberately non-functional Stripe test key. It verifies:

- Pilot acknowledgement is required for business signup and a provider session is created.
- A listing can be drafted but is hidden from public discovery when unverified.
- Unverified and subsequently revoked providers receive HTTP 409 on a payment-bearing booking route **before Stripe is called**.
- Fake evidence is encrypted in database storage; reviewer downloads round-trip the original sample bytes.
- Reviewers require explicit permission and cannot review their own business.
- Independent approvals release the listing; revocations immediately hide it.
- Audit entries are written and no real payments or even local booking rows are created.
- Database schema is deleted after the test.

This is full **fictional provider onboarding and eligibility testing**, not live Stripe payout onboarding, automatic document authentication, real identity verification, a browser-automation test, or a public beta launch.

## Before live partners register

- Complete independent security and legal review of evidence capture, malware scanning, retention, key rotation, privacy, consent, access logs and breach response.
- Verify business email and Stripe Connect onboarding flow with explicit test accounts.
- Determine which categories require additional licenses and insurance and establish a process to check authenticity.
- Prepare authentic provider agreement, privacy policy, service cancellation/refund policy and customer support process.
- Confirm the platform can handle charge failures after service and has a designated backup incident responder.
- Complete separate staging deployment/preview testing and sign-off before real-payment activation.
