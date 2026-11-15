# Real Stripe TEST-mode RouteDrop reconciliation

This is an opt-in integration test. It is **not** the production RouteDrop application, and **must never** be configured with live payment credentials or an existing application `DATABASE_URL`.

## What the test proves

1. A fictional customer creates a deferred booking by using the real RouteDrop HTTP handler.
2. Stripe creates a genuine **test-mode Checkout setup session**. This test does **not** finish that hosted Checkout page.
3. The runner creates a genuine **separate Stripe test SetupIntent** with Stripe's test fixture `pm_card_visa` for the same fictional Stripe customer.
4. The runner sends an expressly **synthetic** `checkout.session.completed` test event into a locally HMAC-validated webhook. RouteDrop independently retrieves the real succeeded SetupIntent before allowing the booking to become `requested`. This step is **not** proof of hosted Checkout completion or a real Stripe-delivered setup webhook.
5. The fictional provider accepts the booking; completion is blocked until the appointment starts. The test advances time by changing the appointment timestamp **only inside an ephemeral PostgreSQL test schema**.
6. The provider completes work. Unauthorized customer confirmation is blocked; explicit customer consent is required.
7. The authorized fictional customer confirms, causing **one real Stripe TEST payment** of $75; the payment includes a $6 platform application fee and a transfer destination corresponding to the test provider account. The $69 share is before any Stripe processing fees.
8. The runner reads a genuine `payment_intent.succeeded` event from Stripe's test Events API and replays that event over HTTP with a **local test signing key** through a Stripe-SDK-validated webhook route, twice to prove event-id deduplication. This tests verification and event reconciliation, but **not** Stripe-to-Render webhook delivery.
9. RouteDrop's disposable database reflects `paid` only after the signed event is accepted. Existing RouteDrop bookings are untouched.

### Before running (one-time GitHub setup)

In the `Ave4prezi/routedrop` GitHub repository, go to **Settings → Environments** and create a protected environment named `routedrop-stripe-test`, with reviewers or an appropriate approval rule.

Add the following **environment secret**:

- `ROUTEDROP_STRIPE_TEST_KEY`: a Stripe `sk_test_...` secret API key for the RouteDrop test platform only. Store in GitHub's secret field; **never commit it or paste it into chat**.

Add these **environment variables** (account IDs, not keys):

- `ROUTEDROP_STRIPE_TEST_PLATFORM_ID`: `acct_1UW6a5LqRW6nZIst` (the dedicated RouteDrop test platform account).
- `ROUTEDROP_TEST_PROVIDER_ACCOUNT_ID`: `acct_1UZc0kLnWnjdMpkQ` (the fictional Avenue89 test connected account with test payouts enabled).

After the workflow is present on the repository default branch, run **Actions → RouteDrop Stripe test-mode reconciliation → Run workflow** using the reviewed branch. The manual job uses the protected environment. The automatically triggered branch job always runs **without** any Stripe secret and only checks the existing mocked booking lifecycle and runner syntax.

### Safeguards and limitations

- Refuses any key other than `sk_test_...`. Refuses a mismatched Stripe platform account, an unready connected provider account, a non-disposable database name, or a live approval flag.
- PostgreSQL is a temporary local GitHub Actions service database named `routedrop_ci`; per-run schema is deleted at the end.
- The real test-mode transaction modifies only *new test Stripe objects* in the specified test account, never the existing RouteDrop paid booking or Neon sandbox database.
- The test account's Stripe test balance and event history will reflect the new simulated $75 transaction. No real money moves.
- Does not automate the hosted Checkout interface; does not verify outbound delivery from Stripe to the Render webhook URL. Those remain separate tests.
- **Do not merge the test runner or workflow to production branches automatically.** Review changes and environment protections before making manual workflow access available.

## Local invocation (optional)

Use disposable PostgreSQL and an isolated `sk_test_` key; never configure these with production credentials:

```sh
cd routedrop-platform
ROUTEDROP_REAL_STRIPE_E2E=true \
ROUTEDROP_TEST_DATABASE_URL='postgres://postgres:localonly@localhost:5432/routedrop_ci' \
ROUTEDROP_STRIPE_TEST_KEY='<enter sk_test_ key locally>' \
ROUTEDROP_STRIPE_TEST_PLATFORM_ID='acct_1UW6a5LqRW6nZIst' \
ROUTEDROP_TEST_PROVIDER_ACCOUNT_ID='acct_1UZc0kLnWnjdMpkQ' \
node --test test/stripe-real-test-reconciliation.test.js
```

No credentials are stored in the repository.
