# RouteDrop founding-business pilot: counsel and operations review packet

**ATTORNEY/OPERATOR WORKING DRAFT — NOT APPROVED, NOT FOR PUBLICATION, SIGNATURE, INVITATIONS OR REAL DOCUMENTS.**

This packet consolidates decisions necessary for a limited Alabama-focused provider pilot. It does not assume a specific attorney has agreed to represent RouteDrop, that a legal entity has been confirmed, or that named staff are on call.

## A. Attorney decision checklist

1. **Operating entity:** Confirm exact business entity, registration and service address; authorized contract signer and tax/payment role.
2. **Marketplace status:** Review the provider/customer contractual relationship, responsibility for service quality, classifications and appropriate insurance. Approve or exclude higher-risk categories (regulated trades, childcare/care services, transportation and others) before invitation.
3. **Provider agreement:** Review `DRAFT_PROVIDER_AGREEMENT.md` and approve a numbered, effective-dated version. Proposed founding pilot: no monthly membership, 8% provider-paid platform fee only from successful collected service payments. Confirm treatment of taxes, Stripe costs, refunds, transfers, disputes and cancellations.
4. **Payment consent:** Require customer to see quoted service total, securely save card with Stripe, and explicitly confirm completion and authorize the charge after service. Review nonpayment, chargebacks, returns, reversals and cancellation policy.
5. **Privacy notice and data flows:** Review `PROVIDER_PRIVACY_NOTICE_DRAFT.md`; identify the exact data needed, lawful bases where applicable, legal rights by jurisdiction, processors and user notices. Verify retention/deletion, backups, logs, access control and breach response.
6. **Breach notification:** Confirm which Alabama and other state/federal laws could apply; assess individual and regulator notice triggers and statutory timelines **based on incident facts**, not a blanket promise. For example, Alabama Code § 8-38-6 includes conditional Attorney General notice for breaches affecting more than 1,000 Alabama residents when notice is required; counsel must review exceptions and current legal text.
7. **Customer support:** Review complaints, notices, dispute escalation, contact details, response promises, cancellation/refund handling and provider suspension/appeal terms.
8. **Contacting prospects:** Approve any consent-based expression-of-interest process that does not collect identity/insurance documents. A private beta invitation does **not** imply that unapproved service terms or payment capabilities are live.

## B. Operations decisions requiring real owners

| Decision | Current status | Required named approval/evidence |
| --- | --- | --- |
| Support primary and backup | **UNASSIGNED** | Verified, available channels and coverage hours |
| Security/incident lead and backup | **UNASSIGNED** | Incident escalation path and secure contact |
| Privacy/data-rights contact | **UNASSIGNED** | Controlled inbox, verification and response SOP |
| Legal counsel/signature | **NOT ENGAGED/CONFIRMED** | Approved agreement/privacy notice and service scope |
| Real provider eligibility reviewer | **UNASSIGNED** | Training, license/insurance authenticity procedures |
| Independent launch decision maker | **UNASSIGNED** | Sign-off authority, review log and appeals |
| Actual malicious-file scanner | **NOT PROVISIONED/VERIFIED** | Private deployment, uptime checks and negative tests |
| Real outbound reminder delivery | **NOT IMPLEMENTED** | Independent scheduler, email monitoring and fallback |
| Retention/deletion and backups | **NOT APPROVED** | Signed schedule, deletion test and restoration plan |
| Stripe LIVE onboarding/payouts | **NOT AUTHORIZED** | Separate reviewed change, test evidence and approval |
| Real pilot schedule and service categories | **UNDECIDED** | Risk-scoped pilot plan and service-area boundaries |

## C. Controlled tabletop plan

Use only invented `example.test`, `example.invalid`, `ci.invalid` accounts and sample documents. Run four drills using `SYNTHETIC_SUPPORT_TRIAGE_RUNBOOK.md` and test scripts: (1) leaked operator access/revocation, (2) expiry of a required insurance file, (3) fictional privacy deletion/support routing and audit, (4) ambiguous Stripe TEST charge/refund without recharging. A real incident procedure must operate outside the app if the app itself fails.

**Pass criteria:** request flow gated, no uncontrolled personal data, two-person reviewer independence, immediate revocation, successful evidence tracking and human acknowledgement of all unresolved actions. **Fail criteria:** access bypass, undocumented information collection, a real transaction, missing authorized responder, or unsupported claims of legal completion.

## D. Attorney packet references

- `DRAFT_PROVIDER_AGREEMENT.md` — existing unsigned draft
- `PROVIDER_PRIVACY_NOTICE_DRAFT.md` — unsigned privacy draft
- `PILOT_SUPPORT_PLAYBOOK_DRAFT.md` — nonbinding operating procedures
- `PILOT_PROVIDER_READINESS.md` — list of unresolved launch gates
- `INDEPENDENT_SECURITY_REVIEW_BRIEF.md` — technical scope and test artifacts
- `PRELAUNCH_DECISION_REGISTER.md` — sign-off record

Authoritative guidance for counsel (not legal advice):
- Alabama Code § 8-38-6: https://law.justia.com/codes/alabama/title-8/chapter-38/section-8-38-6/
- FTC breach response: https://www.ftc.gov/business-guidance/resources/data-breach-response-guide-business

**State: NO GO for real documents, active provider invitations promising verification, live customer payments, or a public launch.** Counsel and independent assessors must decide readiness; this packet does not grant approval.
