# Stripe setup and acceptance for #115

Auth0 production rollout does not block creating the Stripe product, configuring
webhooks/portal, or running the read-only setup check. The real Checkout smoke
test still needs a working application session. Do not add an authentication
bypass to production to test billing.

## Configure the project's Stripe sandbox/test mode

1. Sign in to the Stripe account owned by the project. Work in a sandbox or test
   mode. Live account activation and real payment details are unnecessary for
   the acceptance test.
2. In Product catalogue, create **Voltix AI Pro** with one fixed recurring price.
   Agree the amount, currency and interval with the team; none is assumed by the
   code. Copy the resulting `price_...` identifier. Do not use a metered price.
3. In the customer portal settings, activate the default configuration and enable
   payment-method updates and subscription cancellation. Cancellation at period
   end keeps Pro until the paid subscription actually ends.
4. Create a webhook event destination for **your account**, in the same test mode:

   ```text
   https://voltix-ai-backend.vercel.app/api/billing/webhook
   ```

   Subscribe to:

   ```text
   checkout.session.completed
   checkout.session.async_payment_succeeded
   customer.subscription.created
   customer.subscription.updated
   customer.subscription.deleted
   invoice.paid
   invoice.payment_failed
   ```

5. Store these values only in the backend environment (locally in ignored
   `backend/.env`, or in the backend Vercel project's environment variables):

   ```dotenv
   STRIPE_SECRET_KEY=sk_test_YOUR_ACCOUNT_KEY
   STRIPE_PRO_PRICE_ID=price_YOUR_RECURRING_PRICE
   STRIPE_WEBHOOK_SECRET=whsec_YOUR_DESTINATION_SECRET
   FRONTEND_URL=https://voltix-ai-frontend.vercel.app
   ```

   Keep the existing database, Auth0 and Groq settings. A restricted key can also
   be used if it has the permissions required by Checkout, customer creation,
   subscription retrieval and the customer portal. The setup check additionally
   needs read access to prices, webhook endpoints and portal configurations.
   No Stripe secret belongs in frontend/Vite variables or a committed file.

6. Redeploy the backend after changing its Vercel variables. Verify that the
   destination's signing secret is used, not a Stripe CLI listener secret.
   A shared database must use one consistent Stripe account/mode; use a separate
   database for an independent sandbox deployment so test subscriptions cannot
   change real users' plans.

## Check configuration without Auth0

From `backend`, using the same environment as the intended deployment:

```sh
npm run billing:check -- --webhook-url https://voltix-ai-backend.vercel.app/api/billing/webhook
```

This command only reads Stripe configuration. It verifies that the Pro price is
active and recurring in the expected mode, the exact webhook URL is enabled for
all required events, and the default portal supports payment-method updates and
cancellation. It reports the price in minor currency units, currency and billing
interval without printing API keys or signing secrets. A failed check exits 1.

The command defaults to test keys. Pass `--live` only when intentionally checking
live configuration. An environment file can be selected with `DOTENV_CONFIG_PATH`.
For a local Stripe CLI listener, use:

```sh
stripe listen --forward-to localhost:5001/api/billing/webhook
npm run billing:check -- --local-listener
```

Set the listener's `whsec_...` secret in the local backend environment and use
`FRONTEND_URL=http://localhost:5173`. The listener's forwarding and a real signed
delivery remain manual checks. Listing a destination cannot prove that its
signing secret matches the backend; the actual delivery test below is required.

## Test acceptance

Use a disposable application account on Free and the Stripe test card
`4242 4242 4242 4242`, a future expiry and any valid test CVC.

1. Open Billing and confirm Free shows 20 messages/month and 1 saved project.
   The page displays a test-payment notice when a test API key is configured.
2. Import one repo or ZIP. Another import must return 402 and save no new row.
   File browsing and reopening a saved project must not change message usage.
3. Start Checkout, return using Cancel, and verify the account is still Free.
   Reopening an unfinished checkout reuses it instead of creating a second one.
4. Complete the test payment. Inspect Stripe's actual event delivery to the
   destination: it must return 200. Refresh Billing and confirm Pro shows
   500 messages/month and 20 projects. A second import must now succeed.
5. Replay a delivery. Plan/usage must remain consistent without duplicate event
   processing. An unsigned request to the webhook must return 400.
6. Use the portal to schedule cancellation and confirm Pro remains active for
   the paid term. End the test subscription immediately in the Stripe dashboard
   to verify the ended event returns the account to Free without deleting its
   projects or resetting its monthly usage. Test payment failure and recovery
   with Stripe test payment methods/test clocks as appropriate.
7. After #113/#114 connect `chatQuota` or `consumeChatMessage`, send a question
   and request an edit. Each generation must consume exactly one message, and
   Free message 21 must return 402 before any model call. The existing Jest quota
   route uses a test handler; it is not evidence of a deployed `/api/chat` route.

## Current status

Billing UI, authenticated Checkout/portal endpoints, signed idempotent webhooks,
monthly quota service, and import limits are implemented. The production schema
matches the committed Prisma schema; its already-present billing migration was
reconciled in migration history after a schema diff confirmed no differences.

No project Stripe account is configured in the local environment yet. A real
Stripe checkout, signed destination delivery, payment failure/recovery, and
subscription-end smoke test remain pending account access and configuration.
Full #115 closure also needs the #113/#114 route/UI integration. Passing the
setup command or unit tests does not replace those smoke tests.
