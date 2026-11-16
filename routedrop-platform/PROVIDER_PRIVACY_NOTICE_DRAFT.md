# RouteDrop privacy notice and data-handling procedure — COUNSEL REVIEW DRAFT

**NOT APPROVED OR PUBLISHED.** This is an internal privacy-design and readiness document for RouteDrop's proposed founding-business pilot. It is not a substitute for legally reviewed privacy notices or procedures. The current private preview intentionally uses invented identities and test documents only.

## Proposed public-facing explanation (requires legal approval)

RouteDrop is designed to connect customers seeking local services with businesses offering appointments. Account registration would ordinarily involve contact and business information, scheduling details, and, for certain service categories, proof of provider qualifications. Payment card setup and payments would be handled through Stripe-hosted processes rather than by collecting card numbers in RouteDrop's registration forms. Before collecting real credentials or enabling real payments, RouteDrop must publish approved details about the operating legal entity, contact channels, legal processing basis where applicable, vendors, data retention, user requests and security safeguards.

**Current status:** No real IDs, driver's licenses, insurance policies, background-check reports, banking details or live payment credentials are authorized in the synthetic-preview environment.

## Draft data inventory and restrictions

| Data type | Purpose | Handling limit |
| --- | --- | --- |
| Account email, name, business name, service category/city | Sign-in, business discovery, replies | Minimal necessary fields; do not expose private email in listings |
| Password verification | Authenticate accounts | Password hashes, secure cookies and account reset; never log passwords |
| Listing and booking details | Service scheduling, agreed quote and fulfillment | Limit access by account/role, avoid unnecessary precise locations |
| Credential review data | Determine eligible listing categories | Only after real intake is approved; currently **invented evidence only** |
| Stripe references, payment status, refund/dispute IDs | Verify payments and reconcile incidents | Stripe-hosted card collection; do not store full PAN/CVV |
| Operator grants, review notes and audit records | Accountability and incident investigation | Separate restricted roles, redacted notes without IDs/policy numbers |

Before launch, build a complete data-flow map including Render, Neon, Stripe, hosting logs, external email processors, backups, support vendors and all subprocessors.

## Data minimization, retention and rights — OPEN DECISIONS

- Do not collect real identity/insurance documents until malware scanning, access restrictions, independent security review, key management, data-subject notice and a legally reviewed purpose are in place.
- Draft retention schedule: **NOT APPROVED**. Decide different periods for account information, inactive/rejected/approved documents, audit trails, failed payments, support correspondence, backups and deletion requests; document exceptions for legally required preservation and active disputes.
- Define contact routes for access, correction, deletion, retention questions and appeal. **No valid privacy contact address is assigned yet.**
- Define how deletion propagates across databases, backups, exported records and subprocessors, plus exceptions and verification of requester identity without asking for extra unnecessary data.
- Do not promise absolute deletion from backups, zero breach risk, credential authenticity or compliance certification without technical and legal evidence.
- Keep business/customer data separate from operator review notes and never expose raw evidence in emails, URL query strings or support logs.

## Incident handling — DRAFT

1. Detect and triage suspected compromised account/document access, unexpected downloads, malicious file intake, broken role isolation or exposed payment metadata.
2. Preserve investigation evidence and timestamps; restrict impacted role grants/sessions and disable real-document intake if it ever exists. Engage incident lead, security engineer, affected vendor and counsel.
3. Contain and investigate scope without destroying forensic evidence; determine actual data categories and affected people.
4. Ask Alabama-qualified counsel to determine if/when breach notice is legally required and to whom. **Do not assume that every incident triggers the same legal deadline.**
5. Prepare approved, factual notification and support routes; document decisions, remediation, vendor actions and post-incident review.

References for legal/security review:
- FTC: https://www.ftc.gov/business-guidance/resources/data-breach-response-guide-business
- FTC: https://www.ftc.gov/business-guidance/resources/protecting-personal-information-guide-business
- Alabama Attorney General: https://www.alabamaag.gov/data-breach-notification/
- Alabama Data Breach Notification Act of 2018 (counsel should confirm current statutes, including consumer and Attorney General notification provisions).

## Required approvals before real invitations

- [ ] Operating legal entity, business address and named privacy/security contact
- [ ] Lawyer-reviewed privacy notice, terms, retention periods and regulatory applicability
- [ ] Vendor agreements/data-processing review; credentials/access list and backup disclosure
- [ ] Malware scanner deployed; scanner-failure behavior tested and independently reviewed
- [ ] Operator training, incident response roster, tabletop exercise and deletion rehearsal
- [ ] Real verification policy, appeal process and fair access/support standards
- [ ] Explicit authorization for a new real-data environment and launch review

Until all items are approved, the only authorized provider preview uses invented data.
