# RouteDrop: real-provider prelaunch decision register

**CURRENT DECISION: NO GO.** This record is for human reviewers, not a configuration switch. No single draft PR, passing test, simulation, synthetic approval or user checkbox authorizes real identity-document intake, live charges or public business signup.

| Required gate | Current status | Who must sign off | Evidence to attach |
| --- | --- | --- | --- |
| Correct legal entity and provider terms | BLOCKED | Authorized operator and Alabama-qualified counsel | Entity documents; signed versioned provider contract |
| Public privacy/data-handling notice | BLOCKED | Counsel/privacy lead | Accepted notice, processor map, data inventory |
| Retention, deletion, legal holds and backup | BLOCKED | Privacy lead/security assessor | Signed retention matrix, deletion/restoration rehearsal |
| Real scanner and secure credential intake | BLOCKED | Security assessor | Installed scanner telemetry and failure-mode report |
| Credential licensing/insurance authenticity | BLOCKED | Compliance/operations reviewer | Category matrix, credential checking and appeals |
| Least-privilege operators and secure sign-in | BLOCKED | Security assessor and ops owner | MFA/SSO or justified alternative; external access test |
| Support, privacy and incident contacts | BLOCKED | Actual primary + backup responders | Verified contact channels, staffed schedule |
| Scheduled reminder delivery | BLOCKED | Operations and security | Delivery monitoring and exception/drill report |
| Payments/webhook/refunds reconciliation | BLOCKED | Payments owner and security | Stripe test logs, end-to-end tests, failure/retry policy |
| Isolated real-data pilot environment | BLOCKED | Infra owner and independent assessor | Service, DB, backups and secret management proof |
| Explicit real-data and launch authorization | BLOCKED | Authorized business owner + reviewers | Dated signed go/no-go decision and rollback plan |

## Release accountability

- Legal entity: NOT CONFIRMED
- Operator/contract signer: NOT NAMED
- Primary support contact + hours: NOT ASSIGNED
- Backup support contact: NOT ASSIGNED
- Privacy contact: NOT ASSIGNED
- Security incident lead + backup: NOT ASSIGNED
- Independent assessor: NOT ENGAGED/CONFIRMED
- Counsel: NOT ENGAGED/CONFIRMED
- Go-live approver: NOT NAMED
- Real-provider pilot approval date: NONE

## Safe next actions

1. Identify legal entity, owner/operator authority, support/incident contacts and budget.
2. Give counsel the contract, refund, privacy, retention and service-category packet for legal review.
3. Give external independent assessor a **redacted** technical diagram and a temporary, least-privilege synthetic-only test environment. Never email private keys/credentials or real IDs.
4. Record test scope, findings, fixes and signature evidence. Keep real document intake and live payments disabled until all blocking gates are signed and retested.
5. Review deployment, DNS, payment authorization and incident rollback as a separate, explicit owner-approved change.

**No approvals are inferred from GitHub status or configuration values.**
