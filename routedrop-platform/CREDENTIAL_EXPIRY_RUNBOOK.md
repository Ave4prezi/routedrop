# RouteDrop credential-expiry reminders — synthetic preview

**Status:** implemented in private preview for fictional data. Not a real license/insurance renewal service or external notification system.

## What the software does

- An approved credential with an expiry within **30 calendar days**, or one that is already expired (until renewed), appears in the fictional business's Business Studio and the separate credential-reviewer's restricted queue.
- Notices classify upcoming/urgent/expired and show days remaining. Alerts change as deadlines approach, independent of server wake/sleep.
- The reminder scanner logs a unique reminder record when the credential first falls within the **30-, 14-, 7-, 1-day, or expired (0-day)** windows. A database unique key on business/credential/expiry/window makes repeats idempotent.
- An immediate scan runs after database initialization, and a best-effort scan runs every six hours **while the free preview server is awake**. Sleeping or downtime can delay persisted reminder events; dashboard queries calculate current deadlines directly instead.
- **No email, SMS, third-party message, or real provider notification is sent.** There are no guaranteed external reminder deliveries.
- Expired required credentials prevent listing eligibility. Updating or resubmitting credentials invalidates stale independent launch approval; a new launch approval is required to release the fictional listing.

## Operator procedure

1. Credential reviewer opens **Expiring credentials** with an individually authorized, time-limited role.
2. Prioritize expired/7-day items; use only the minimum fictional business details shown.
3. Invite the simulated provider to renew fake evidence through the test interface. Do **not** ask for real driver's licenses, insurance policies or identity documents.
4. Independently review revised fake credentials, record validity/expiry and decision reasons, then send to the separate launch operator for fresh category approval if needed.
5. Confirm expired or revoked credential immediately hides affected listings; follow up before any pending pilot test slot.
6. Escalate any system failure or incorrect eligibility calculation as an access/payment safety issue; preserve audit evidence.

## Before notifying real businesses

- Approve the legal significance and authenticity checks for each required credential, including the relevant service categories.
- Confirm which expiry dates and renewal rules are legally meaningful; do not assume a single 12-month cycle fits all licensing/insurance.
- Implement verified customer/provider email delivery, delivery monitoring, opt-out/transactional notice handling, queue retries, dedicated schedule independent of sleeping web services, privacy controls and assigned responder.
- Test expired credentials, repeated reminders, time zones, changed dates, revocations and deleted accounts with real security procedures.
- Obtain privacy/legal/security approval and **explicitly authorize** a new deployment; do not repurpose the synthetic preview as a production credential-verification system.
