# RouteDrop staging: independent dispute review

This flow is a **draft staging feature**. It is not deployed by creating this branch/PR. The Render staging blueprint has automatic deployment disabled, and production must remain unchanged.

## Safety contract

- Customer reports a problem only after the provider marks work complete and before a payment is created.
- Disputed bookings retain the payment lock. Ordinary customer confirmation and recovery endpoints refuse to collect payment.
- A support agent is provisioned independently, not through sign-up. A support agent who is the customer or provider on the disputed job is **not permitted** to decide that job.
- Support may (a) close the dispute without charging and cancel the booking, or (b) request a fresh customer decision. Support cannot charge the saved card.
- In the second option, the booking remains `disputed` until the actual customer views the support resolution note, explicitly accepts it, and *separately* presses “Confirm completed job & pay” to authorize a charge. Declining the proposal leaves the dispute and card lock in place.
- A customer can report a new issue after acceptance, while the job is `work_completed` and before a PaymentIntent exists.
- An append-only event log records customer reports, support decisions, and customer responses.
- Paid Stripe disputes, existing payment intents, pending refunds, and ambiguous payment results are **not** eligible for this pre-payment review flow and require manual reconciliation.

## Support account setup (after an approved isolated staging deploy)

1. Create a separate test **customer-type** account to act as support using the normal registration flow. Do not use either participant's account for the reviewed booking.
2. Confirm the independent account's user ID from staging Neon, manually, with verified identity and explicit platform-owner approval.
3. Grant support access in the **staging database only** using a parameterized insert:
   `INSERT INTO deferred_support_agents(user_id) VALUES ($1) ON CONFLICT DO NOTHING;`
   The ID must belong to the approved independent account. There is deliberately no registration or website control that grants support rights.
4. Sign in with that account. A **Support reviews** link should appear. Open the active disputed booking and choose **Close without charge** or **Request customer approval**, recording a factual note visible to the customer and provider.
5. Verify the customer sees the proposed note. Confirm that rejecting the proposal leaves the card uncharged; accepting alone still does not initiate a charge.

## Test plan after deployment approval

Use the separate RouteDrop staging website, Neon test project, Stripe **test** credentials, and test customer/provider/support accounts. First create a **fresh test booking** so existing disputed Booking #7 remains untouched.

1. Provider accepts and completes the new test service, after the scheduled start; customer reports a problem.
2. Confirm the booking is `disputed`, without `payment_intent_id`, `confirmed_at`, or `paid_at`.
3. Attempt an authorized customer's normal confirmation while disputed. Expect HTTP 409 and no Stripe PaymentIntent or transfer.
4. Try the support decision with an unprovisioned account, customer, and provider. Expect HTTP 403.
5. Independent support requests customer approval, entering a neutral note. The customer sees it in the booking and the status remains disputed.
6. Customer declines; confirm no charge. A new support decision may close the dispute without payment.
7. Repeat on a new disposable test booking; customer accepts the proposed resolution. Confirm status becomes `work_completed` with no charge. Only after separate customer confirmation should Stripe **test mode** process the original quoted amount and 8% application fee.
8. Review `deferred_dispute_events` and `deferred_dispute_reviews` for the correct actor and chronology. Verify duplicate decisions are rejected.
9. Confirm existing paid/refunded bookings, refunds, and original production flows remain unchanged.

## Rollout controls

- First require GitHub CI success on the feature branch and code review of PR #3.
- Get **explicit approval** before merging the draft PR or deploying to staging. Do not enable live Stripe keys or live payments.
- Use a staging backup/snapshot and deployment rollback plan. Never migrate or modify a production Neon database.
- Do not grant access to a real involved party as an independent reviewer.
- Do not move Booking #7 to `work_completed`, `paid`, or `canceled` while reviewing this change.
- Run authenticated staging tests and verify Stripe test records before declaring end-to-end dispute resolution complete.
