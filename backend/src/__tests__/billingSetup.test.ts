import Stripe from 'stripe';
import { checkStripeSetup } from '../billing/checkSetup';
import { BILLING_WEBHOOK_EVENTS } from '../billing/events';

const webhookUrl = 'https://api.example.test/api/billing/webhook';
const price = { active: true, type: 'recurring', recurring: { usage_type: 'licensed', interval: 'month', interval_count: 1 },
  billing_scheme: 'per_unit', unit_amount: 1000, currency: 'cad', livemode: false, transform_quantity: null };
const portal = { livemode: false, features: { payment_method_update: { enabled: true }, subscription_cancel: { enabled: true } } };
const endpoint = { url: webhookUrl, status: 'enabled', livemode: false, enabled_events: [...BILLING_WEBHOOK_EVENTS] };
const retrieve = jest.fn();
const portals = jest.fn();
const endpointList = jest.fn();
const endpointPages = jest.fn();
const stripe = { prices: { retrieve }, billingPortal: { configurations: { list: portals } },
  webhookEndpoints: { list: endpointList } } as unknown as Stripe;

beforeEach(() => {
  jest.clearAllMocks();
  retrieve.mockResolvedValue(structuredClone(price));
  portals.mockResolvedValue({ data: [structuredClone(portal)] });
  endpointPages.mockResolvedValue([structuredClone(endpoint)]);
  endpointList.mockReturnValue({ autoPagingToArray: endpointPages });
});

it('checks the configured price, exact destination, event coverage and default portal without creating anything', async () => {
  const result = await checkStripeSetup(stripe, { priceId: 'price_test', mode: 'test', webhookUrl });
  expect(result.ok).toBe(true);
  expect(result.price).toMatchObject({ unitAmount: 1000, currency: 'cad', interval: 'month' });
  expect(result.checks.find(check => check.name === 'Signed delivery')?.status).toBe('manual');
  expect(portals).toHaveBeenCalledWith({ active: true, is_default: true, limit: 1 });
});
it.each([
  { active: false }, { type: 'one_time', recurring: null }, { livemode: true },
  { recurring: { usage_type: 'metered' } }, { unit_amount: 0 },
])('rejects a price that cannot represent the expected paid plan: %j', async change => {
  retrieve.mockResolvedValue({ ...price, ...change });
  const result = await checkStripeSetup(stripe, { priceId: 'price_test', mode: 'test', webhookUrl });
  expect(result.ok).toBe(false);
  expect(result.checks.find(check => check.name === 'Pro price')?.status).toBe('fail');
});
it('detects the wrong webhook URL and missing events', async () => {
  endpointPages.mockResolvedValue([{ ...endpoint, url: 'https://other.example.test/api/billing/webhook' }]);
  expect((await checkStripeSetup(stripe, { priceId: 'price_test', mode: 'test', webhookUrl })).ok).toBe(false);
  endpointPages.mockResolvedValue([{ ...endpoint, enabled_events: ['checkout.session.completed'] }]);
  const result = await checkStripeSetup(stripe, { priceId: 'price_test', mode: 'test', webhookUrl });
  expect(result.ok).toBe(false);
  expect(result.checks.find(check => check.name === 'Webhook destination')?.message).toContain('invoice.payment_failed');
});
it('accepts an enabled wildcard destination but rejects a disabled one', async () => {
  endpointPages.mockResolvedValue([{ ...endpoint, enabled_events: ['*'] }]);
  expect((await checkStripeSetup(stripe, { priceId: 'price_test', mode: 'test', webhookUrl })).ok).toBe(true);
  endpointPages.mockResolvedValue([{ ...endpoint, status: 'disabled' }]);
  expect((await checkStripeSetup(stripe, { priceId: 'price_test', mode: 'test', webhookUrl })).ok).toBe(false);
});
it('requires cancellation and payment-method updates in the default portal', async () => {
  portals.mockResolvedValue({ data: [{ ...portal, features: { ...portal.features, subscription_cancel: { enabled: false } } }] });
  expect((await checkStripeSetup(stripe, { priceId: 'price_test', mode: 'test', webhookUrl })).ok).toBe(false);
});
it('does not claim a local listener or signing secret has been remotely verified', async () => {
  const result = await checkStripeSetup(stripe, { priceId: 'price_test', mode: 'test', localListener: true });
  expect(endpointList).not.toHaveBeenCalled();
  expect(result.ok).toBe(true);
  expect(result.checks.filter(check => check.status === 'manual')).toHaveLength(2);
});
it('turns Stripe API failures into safe diagnostics without echoing a credential', async () => {
  retrieve.mockRejectedValue(new Error('Invalid API Key provided: sk_test_secret_value'));
  portals.mockRejectedValue(new Error('permission denied'));
  endpointPages.mockRejectedValue(new Error('permission denied'));
  const result = await checkStripeSetup(stripe, { priceId: 'price_test', mode: 'test', webhookUrl });
  expect(result.ok).toBe(false);
  expect(JSON.stringify(result)).not.toContain('sk_test_secret_value');
});
