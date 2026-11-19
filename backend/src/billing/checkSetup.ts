import Stripe from 'stripe';
import { BILLING_WEBHOOK_EVENTS } from './events';

type Check = { name: string; status: 'pass' | 'fail' | 'manual'; message: string };
export type SetupOptions = {
  priceId: string;
  mode: 'test' | 'live';
  webhookUrl?: string;
  localListener?: boolean;
};

/** Read-only Stripe checks. No customers, prices, subscriptions or endpoints are created. */
export async function checkStripeSetup(stripe: Stripe, options: SetupOptions) {
  const checks: Check[] = [];
  const [priceResult, portalResult, endpointsResult] = await Promise.allSettled([
    stripe.prices.retrieve(options.priceId),
    stripe.billingPortal.configurations.list({ active: true, is_default: true, limit: 1 }),
    options.localListener ? Promise.resolve(null) : stripe.webhookEndpoints.list({ limit: 100 }).autoPagingToArray({ limit: 10_000 }),
  ]);
  let priceDetails = null;
  if (priceResult.status === 'fulfilled') {
    const price = priceResult.value;
    const valid = price.active && price.type === 'recurring' && price.recurring?.usage_type === 'licensed'
      && price.billing_scheme === 'per_unit' && price.unit_amount !== null && price.unit_amount > 0
      && !price.transform_quantity && price.livemode === (options.mode === 'live');
    checks.push({ name: 'Pro price', status: valid ? 'pass' : 'fail',
      message: valid ? 'Active fixed recurring price in the expected mode.' : 'Use an active, positive, fixed recurring licensed price in the expected mode.' });
    priceDetails = { currency: price.currency, unitAmount: price.unit_amount,
      interval: price.recurring?.interval, intervalCount: price.recurring?.interval_count };
  } else {
    checks.push({ name: 'Pro price', status: 'fail', message: 'Price lookup failed. Check the price ID, account, mode and API key permissions.' });
  }
  const portal = portalResult.status === 'fulfilled' ? portalResult.value.data[0] : undefined;
  const portalReady = portal?.livemode === (options.mode === 'live')
    && portal.features.payment_method_update.enabled && portal.features.subscription_cancel.enabled;
  checks.push({ name: 'Customer portal', status: portalReady ? 'pass' : 'fail',
    message: portalReady ? 'Default portal allows payment-method updates and cancellation.'
      : 'Enable a default customer portal with payment-method updates and subscription cancellation.' });
  if (options.localListener) {
    checks.push({ name: 'Webhook destination', status: 'manual',
      message: 'Local listener selected. Verify Stripe CLI forwarding and use its own whsec signing secret.' });
  } else {
    const endpoints = endpointsResult.status === 'fulfilled' ? endpointsResult.value ?? [] : [];
    const endpoint = endpoints.find(item => item.url === options.webhookUrl
      && item.status === 'enabled' && item.livemode === (options.mode === 'live'));
    const missing = BILLING_WEBHOOK_EVENTS.filter(event => !endpoint?.enabled_events.includes('*') && !endpoint?.enabled_events.includes(event));
    checks.push({ name: 'Webhook destination', status: endpoint && missing.length === 0 ? 'pass' : 'fail',
      message: !endpoint ? 'No enabled webhook matches this exact URL and mode (or the key cannot list endpoints).'
        : missing.length ? `Subscribe to these events: ${missing.join(', ')}.` : 'Enabled webhook includes all required billing events.' });
  }
  checks.push({ name: 'Signed delivery', status: 'manual',
    message: 'A real signed delivery must still return 200 and change the intended user plan. Read-only checks cannot verify the configured signing secret.' });
  return { ok: checks.every(check => check.status !== 'fail'), mode: options.mode, price: priceDetails, checks };
}
