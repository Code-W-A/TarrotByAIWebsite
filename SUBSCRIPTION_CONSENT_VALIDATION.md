# Recurring subscription disclosure and consent

Implemented locally on 2026-10-03. No deployment, OTA, store submission, or production billing/account changes were performed by this task.

## Behavior

- Web and mobile display monthly automatic renewal until cancellation, in all 27 supported languages, using Stripe's VAT-inclusive price or the native store price.
- A separate unchecked recurring-payment checkbox gates Checkout, PaymentSheet, and native purchases. Web retains its existing policy checkbox.
- `GET /api/premium/subscription-consent?locale=...` returns a signed offer valid for 30 minutes. It contains the translated disclosure, acceptance wording, version, price, VAT, currency, interval, expiration and `quoteId`. Responses are not cached.
- Both Stripe subscription-start endpoints require `subscriptionConsent: { accepted: true, version, locale, quoteId }`. Offers are checked against fresh Stripe pricing and current VAT before creating payment objects. Non-monthly or unavailable prices fail closed.
- `premiumSubscriptionConsents` stores an independent acceptance with server time and user/channel. Stripe metadata carries its reference; transactionally linked webhook events preserve acceptance and record payment/subscription outcomes. Older events cannot overwrite newer outcomes. Pending creation cannot overwrite an already paid outcome.
- Old mobile clients show the existing API `message` field with a manual website fallback. Native store purchases have the checkbox; this implementation records server evidence only for Stripe.
- Existing subscriptions and one-time purchase APIs are not migrated. No retrospective consent is generated. There is no new confirmation email.

## Validation completed

- Five targeted web suites: 30 passing tests, including both API creation gates, expired/tampered/changed offers, changed VAT, failed persistence, retries, outcome association, cancellation status, event ordering, old-client fallback and all 27 translation catalogs.
- Mobile Premium API suite: 13 passing tests, including transmission of consent and fetching translated offers.
- Opt-in real Stripe TEST integration: passed. Creates a hosted Checkout session with the disclosure, starts the mobile subscription, confirms a test-card payment of EUR 6.05, checks the invoice consent reference and links the paid outcome. Firebase/auth are simulated in memory, so no live Firebase writes occur. The test requires `sk_test_` and cleans up/archives its Stripe fixtures.
- Next.js production build: passed. Expo iOS and Android exports: passed; artifacts were written to `/tmp/cristina-subscription-consent-export`.
- Global mobile TypeScript check has unrelated existing errors (including missing Jest globals). No diagnostics were reported for the changed production mobile files.

## Remaining release checks

- Authenticated visual check of the final web checkbox, including Arabic/Hebrew and narrow screens; native purchase-sheet/device validation. The local browser preview did not render the complete page, so visual acceptance is not claimed. The isolated preview API did return the correct translated VAT-inclusive test offer. These checks are separate from compilation and API tests.
- The existing local Stripe test price is tax-inclusive; both existing payment endpoints require an exclusive price. Real test integration used an exclusive test fixture. The original workspace environment was not changed.
- Publish only with authorization. Release mobile changes before or alongside the web/API release: once validation is enabled, older Stripe clients must use the website manually or update.
- Merge the new server-only Firestore journal rule into actual production rules, checking that any broad allow rule does not expose this collection. The repository rule file is a merge snippet, not proof of live rules.
- Ensure the Premium webhook receives Checkout completion/expiration, subscription lifecycle, invoice payment success/failure. Checkout expiration needs subscription at the external Stripe webhook configuration; this task does not change that configuration.
- After authorized release, verify the displayed live prices, one genuine accepted flow, server journal, payment association, cancellation path and translations. No real-money transaction was run for this task.

## Repeatable tests

```sh
# In next-js
./node_modules/.bin/jest lib/__tests__/subscriptionConsent.test.js tests/api/subscriptionConsentGate.test.js lib/__tests__/premiumSubscriptionGuard.test.js lib/__tests__/premiumMobileCheckoutPolicy.test.js tests/api/premiumPriceChangeConsent.test.js --runInBand
RUN_STRIPE_CONSENT_TEST=1 ./node_modules/.bin/jest tests/api/subscriptionConsent.stripe-test.test.js --runInBand

# In expo-mobile-app
./node_modules/.bin/jest src/features/video-library/services/__tests__/premiumVideoApi.test.ts --runInBand
```
