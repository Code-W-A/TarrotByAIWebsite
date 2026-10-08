# Premium renewal: implementation and release checks

## Behavior

`GET /api/stripe/premium/renewal` reads the authenticated account's current Stripe subscriptions. `POST` accepts `{ action: "cancel" | "reactivate" | "resend", requestId, confirmed: true, locale, subscriptionId? }`. Only reactivation selects a subscription; cancellation always covers all identified Premium subscriptions. IDs used for billing ownership come from Stripe metadata and the server profile, never an email match or a client customer ID.

The resolver paginates Stripe's subscription list to include duplicates across customers without relying on the eventually consistent Search index. Legacy subscriptions can use the owning Customer's `metadata.uid`; missing/conflicting ownership fails explicitly. This deliberately favors a complete lookup over speed. Measure lookup duration against the LIVE account's size before release; the endpoint allows 60 seconds, and interrupted mutations are recoverable.

Cancellation preserves paid access and stops renewal at period end; it does not refund earlier payments or remove outstanding invoices. A future `cancel_at` beyond the current period is not reported as renewal already stopped. The account summary aggregates duplicate subscriptions, preserving independent manual/RevenueCat access.

Only explicit reactivation changes cancellation back to renewal. Price acceptance and tax migration omit cancellation fields (also safe against a concurrent cancellation). The former bulk force-accept/reactivation script is now audit-only and rejects `--apply` before accessing Stripe.

## Persistence and failure handling

- `premiumRenewalRequests`: server-only operation journal keyed by a hash of UID + request ID, with target IDs, per-subscription outcomes, confirmed Stripe summary, profile-sync and email status.
- `premiumRenewalLocks`: server-only per-account transaction lease. A crashed request becomes recoverable after five minutes. Different concurrent actions are rejected while a lease is active.
- The browser retains its operation ID in session storage, scoped to UID, until completion. A reload restores confirmation for safe reconciliation. A lost response never becomes assumed success.
- A Stripe update timeout is followed by a fresh retrieval. Partial results are displayed and retries skip already stopped subscriptions. Completed request IDs cannot be repurposed or replayed to undo a later action.
- Email uses existing `EMAIL_USER` / `EMAIL_PASS`, Gmail by default, or `PREMIUM_SMTP_SERVICE`. Destination comes from Firebase Auth and must have `emailVerified: true`. SMTP delivery failure does not undo cancellation. Explicit resend is available; ambiguous SMTP acceptance is not automatically retried.
- Existing portal callers receive an explicit error if the cancellation flow cannot open; the generic invoice/card portal remains available.
- UI strings are available in Romanian and English in the existing `common` namespace; other locales use the application's existing Romanian fallback. Email is Romanian for `ro`, English otherwise.

## Automated validation

```sh
npx jest --runInBand tests/api/premiumRenewal.test.js tests/api/premiumRenewalRoute.test.js tests/api/premiumRenewalPriceConsent.test.js tests/api/premiumRenewalLegacyPortal.test.js tests/components/premiumRenewal.dom.test.jsx lib/__tests__/stripePremiumSubscriptionSync.test.js tests/api/premiumPriceChangeConsent.test.js tests/api/premiumSubscriptionTaxMigration.test.js lib/__tests__/premiumSources.test.js lib/__tests__/premiumSubscriptionGuard.test.js
RUN_STRIPE_RENEWAL_TEST=1 npx jest --runInBand tests/api/premiumRenewal.stripe-test.test.js
npm run build
```

The opt-in integration test refuses LIVE keys. It creates two paid subscriptions in Stripe TEST, cancels both, repeats the request, reactivates one, closes the duplicate, and checks the same account synchronization used by the webhook. Firebase is an in-memory fixture; Nodemailer renders messages into a local buffer addressed to `renewal-test@example.com`. Test subscriptions/customers are canceled/deleted and the product/price archived in `finally`. It does not send SMTP messages or write to production Firebase.

Covered failures include missing authentication, forged ownership, pagination, legacy metadata, `past_due`, already stopped renewal, cancellation after a future renewal, repeated/concurrent requests, Stripe timeouts and partial failures, failed Firestore writes/sync, failed/unverified email delivery, resumed browser requests, and price acceptance preserving cancellation.

## Before production release

1. Merge the two renewal collection rules in `../expo-mobile-app/firestore.rules` into the complete production rules. That file is an additive reference, not a safe replacement of all deployed rules. Ensure no broader wildcard rule grants client access to these collections. Validate denied client reads/writes before deploying the feature.
2. Verify LIVE `STRIPE_SECRET_KEY` belongs to the intended account and the existing premium webhook is configured for `customer.subscription.created`, `.updated`, `.deleted` and invoice events. Signing uses `STRIPE_WEBHOOK_SECRET_ABONAMENT` (legacy fallback `STRIPE_WEBHOOK_SECRET`); local development also supports `STRIPE_WEBHOOK_SECRET_ABONAMENT_TEST`. Presence in local environment is not proof of production delivery.
3. Verify production SMTP configuration and send one authorized confirmation to a controlled inbox. The automated test checks message generation, not inbox delivery. Confirm that actual customer accounts have verified Auth email addresses if confirmations are required.
4. Exercise authenticated desktop/mobile browser cancellation in a test environment, inspect the journal and Stripe status, and verify a signed webhook end to end. DOM tests and the real Stripe TEST service test do not establish production browser/webhook behavior.
5. Deploy separately with authorization, then monitor `[premium.renewal]` errors, incomplete journals, pending synchronization/email and endpoint duration.

No production deployment, customer cancellation, refund, or LIVE subscription migration is part of the local implementation. Ruxandra's account requires its own historical investigation.
