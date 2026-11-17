# RouteDrop: pay-after-service beta test and go-live controls

**Feature branch only:** `feature/book-free-pay-after-service`. Draft PR #1 targets `routedrop-platform-beta`. No deployment, production database change, Stripe live credential, or live payment approval is part of this test plan.

## Customer and provider transaction contract

- Customer books for **$0 upfront**, selects a provider's fixed-price time slot, and explicitly consents to storing a card for a later payment equal to the quoted amount.
- Setup uses Stripe Checkout `mode=setup` and creates **no charge**. The completed setup session must be confirmed by a signed webhook and a successful Stripe SetupIntent before a reservation is submitted.
- Provider accepts or declines; the accepted provider marks the job completed no earlier than the scheduled start.
- Customer confirms the job and agrees to pay the exact quoted price, or disputes the service before payment.
- On confirmation, the backend uses the saved card **once** through a Stripe test-mode off-session PaymentIntent, with a Stripe Connect destination charge and `application_fee_amount` equal to 8% of the service amount.
- If an off-session card charge requires 3D Secure or is declined, **do not charge automatically again**. Where Stripe independently verifies that the original PaymentIntent was not successful and can be canceled, the customer can open/resume a **single hosted Stripe Checkout payment recovery session**; the original intent is canceled before this Checkout can start.
- Only Stripe-verified success updates the booking to `paid`. Ambiguous, expired, or blocked payments require manual support reconciliation. Receipts and notifications use the database outbox.
- The original connected provider account is saved at booking; later account changes are blocked for the original charge or recovery until reviewed.

## No-cost CI validation (already automated)

- GitHub Actions builds on a disposable runner with PostgreSQL 16, no real customer data or Stripe credentials.
- Node syntax checks `server.js`, `post-service.js`, and `public/app.js`.
- All Node.js regression tests cover consent/state flags, 8% fee, signed webhook handler logic, SetupIntent verification, duplicate booking lock, expired setups, customer ownership of recovery, decline/3DS simulated recovery, destination/amount/customer validation, refunds/disputes as recorded webhook events, and notification text.
- The PostgreSQL test creates its own temporary schema and rolls the entire transaction back. It verifies repeat-safe migrations, slot uniqueness, and preservation of the old `bookings` table.

## Required end-to-end Stripe sandbox cases (NOT yet run)

Use **only** a separate disposable test environment and **test-mode** keys. Do not use the production Render service or its database. If an isolated staging environment costs money or triggers a deploy, get explicit approval first.

1. **Test environment setup:** Obtain disposable PostgreSQL and the *RouteDrop sandbox* Stripe account. Keep all live-payment flags off; configure a temporary HTTPS test domain and corresponding signed webhook. The new feature requires `ROUTEDROP_DEFERRED_BETA_ENABLED=true` and a key with `sk_test_` prefix. Create two Stripe Connect test sellers with completed test onboarding. Do not copy real customer records.
2. **Save card:** Use Stripe's standard test card to make a $100 test service reservation. Check Stripe shows a successful SetupIntent but no PaymentIntent/charge and the provider receives a `requested` booking.
3. **Provider accepts/completes:** Verify the provider can accept/decline only its own bookings and cannot mark work completed before the slot begins. Verify no payment was collected.
4. **Successful payment:** Customer confirms. Confirm Stripe charges exactly $100 in TEST mode, records an $8 application fee and one transfer for the provider's $92 gross share (before payment fees). Verify signed webhook, notification, paid status and duplicate-replay protection.
5. **3DS and decline:** Use Stripe's official test payment methods that require authentication or simulate declines. Confirm no duplicate charge. If an original PaymentIntent is safely cancelable, the customer must complete the separate hosted recovery checkout; otherwise route to manual review. Verify only one successful payment and exactly one 8% fee.
6. **Refund:** In TEST mode, customer requests a post-payment refund through RouteDrop and the responsible provider approves it in Business Studio. Verify Stripe creates **exactly one full refund**, with `reverse_transfer=true` and `refund_application_fee=true`, so the connected transfer and RouteDrop's 8% fee are reversed. Verify the refunded amount, notifications and any `refund.updated`, `refund.failed`, and `charge.refunded` events. Partial refunds remain unsupported. Ambiguous refund status requires manual reconciliation.
7. **Dispute and safety:** Before payment, customer can report incomplete work and prevent charging. After payment, a Stripe test dispute should be linked through the saved PaymentIntent, recorded, and escalated; no second charge.
8. **Email:** With a test email delivery setup only, verify booking requested, accepted, completed, paid, failed, refund update and dispute notifications; do not email real customers. Queued messages have unique event keys and sanitized fields.
9. **Data and permissions:** Verify CSRF, origin, customer/provider ownership, rate limits, same-slot concurrency and old bookings unaffected. Never mutate the current Render production database.
10. **Rollback:** Restore the last known working Render service revision if staging fails. Keep new deferred tables isolated; do not delete legacy bookings or payment intents. Record manual reconciliation for any Stripe events.

## Before production deployment

- [ ] Complete *real* end-to-end Stripe sandbox tests and document results; automated CI/mocked Stripe API tests are **not** equivalent to Stripe-hosted checkout trials.
- [x] Implement draft-only customer refund requests, provider approval and full Stripe refund with transfer/8% fee reversal, including unit-level success/failure safeguards.
- [ ] Test succeeded/failed/pending **real Stripe sandbox** refunds and fee/transfer reversal end-to-end with a connected test provider. Add support reconciliation for ambiguous responses before production.
- [ ] Add monitored support queue for `needs_review`, timed-out recovery and real disputes.
- [ ] Review customer authorization text, provider refund terms, legal/tax/merchant-of-record responsibilities, charge settlement, Stripe fees, and privacy.
- [ ] Confirm Stripe Connect, operational backups and recovery, notification delivery, customer support handling, and a staged deployment/rollback plan.
- [ ] Obtain separate approval before **any** deployment, merging the draft PR, enabling the beta flag, or activating any live Stripe charges.

**Useful Stripe docs:**
- [Save and reuse a payment method](https://docs.stripe.com/payments/save-and-reuse)
- [Stripe Connect destination charges](https://docs.stripe.com/connect/marketplace/tasks/accept-payment/destination-charges)
- [Stripe marketplace refunds and disputes](https://docs.stripe.com/connect/marketplace/tasks/refunds-disputes)
- [3D Secure authentication](https://docs.stripe.com/payments/3d-secure/authentication-flow)
