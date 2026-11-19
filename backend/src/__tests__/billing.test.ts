import { authHeader } from '../testSupport/auth0';
import express from 'express';
import request from 'supertest';
import Stripe from 'stripe';

let mockUser: Record<string, unknown>;
const mockEvents = new Set<string>();
const mockUpdate = jest.fn(async ({ data }) => Object.assign(mockUser, data));
const mockTx = {
  $queryRaw: jest.fn(),
  user: {
    findUnique: jest.fn(async () => mockUser),
    findUniqueOrThrow: jest.fn(async () => mockUser),
    update: mockUpdate,
  },
  stripeEvent: {
    findUnique: jest.fn(async ({ where }) => mockEvents.has(where.id) ? { id: where.id } : null),
    create: jest.fn(async ({ data }) => { mockEvents.add(data.id); return data; }),
  },
  project: { count: jest.fn(async () => 0) },
};
jest.mock('../database/prismaClient', () => ({ prisma: {
  ...mockTx,
  $transaction: (work: (tx: unknown) => Promise<unknown>) => work(mockTx),
} }));
import billingRouter from '../api/billing';
import { stripeWebhook } from '../billing/webhook';
import * as stripeService from '../billing/stripe';
import { assertProjectCapacity, usageMonth } from '../billing/quotas';

// Signature verification uses the actual Stripe SDK. Only outbound Stripe API
// calls and database access are mocked.
const stripe = new Stripe('sk_test_voltix_not_a_real_key');
const retrieve = jest.spyOn(stripe.subscriptions, 'retrieve');
const checkout = jest.spyOn(stripe.checkout.sessions, 'create');
const checkoutRetrieve = jest.spyOn(stripe.checkout.sessions, 'retrieve');
const customer = jest.spyOn(stripe.customers, 'create');
const app = express();
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), stripeWebhook);
app.use(express.json());
app.use('/api', billingRouter);
const webhookSecret = 'whsec_voltix_test_only';
const eventBody = (type = 'checkout.session.completed', id = 'evt_paid') => JSON.stringify({
  id, type, data: { object: type.startsWith('customer.subscription.')
    ? { id: 'sub_test', customer: 'cus_test' }
    : type.startsWith('invoice.')
      ? { customer: 'cus_test', parent: { subscription_details: { subscription: 'sub_test' } } }
      : { subscription: 'sub_test', customer: 'cus_test' } },
});
const postEvent = (type?: string, id?: string) => {
  const body = eventBody(type, id);
  return request(app).post('/api/billing/webhook').set('Content-Type', 'application/json')
    .set('Stripe-Signature', stripe.webhooks.generateTestHeaderString({ payload: body, secret: webhookSecret })).send(body);
};
const subscription = (status = 'active', paid = true) => ({
  id: 'sub_test', status, customer: 'cus_test', metadata: { userId: 'test-user' },
  latest_invoice: { status: paid ? 'paid' : 'open' }, items: { data: [{ price: { id: 'price_pro' } }] },
});
beforeEach(() => {
  jest.clearAllMocks(); mockEvents.clear();
  process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
  process.env.STRIPE_PRO_PRICE_ID = 'price_pro';
  process.env.STRIPE_SECRET_KEY = 'sk_test_voltix_not_a_real_key';
  process.env.FRONTEND_URL = 'http://localhost:5173';
  mockUser = { id: 'test-user', email: 'test@example.com', plan: 'FREE', stripeCustomerId: 'cus_test',
    stripeSubscriptionId: null, stripeCheckoutSessionId: null, subscriptionStatus: null,
    usageMonth: usageMonth(), chatMessagesUsed: 0,
  };
  mockTx.project.count.mockResolvedValue(0);
  jest.spyOn(stripeService, 'stripeClient').mockReturnValue(stripe);
  retrieve.mockResolvedValue(subscription() as never);
  checkout.mockResolvedValue({ id: 'cs_test', url: 'https://checkout.stripe.com/test' } as never);
  customer.mockResolvedValue({ id: 'cus_test' } as never);
});

it('shows authoritative Free limits and current usage', async () => {
  const response = await request(app).get('/api/billing').set(authHeader());
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ plan: 'FREE', limits: { chatMessages: 20, savedProjects: 1 }, remaining: { chatMessages: 20 } });
  expect(response.body.stripeMode).toBe('test');
  expect(JSON.stringify(response.body)).not.toContain(process.env.STRIPE_SECRET_KEY);
});
it('starts subscription checkout without changing the account plan', async () => {
  const response = await request(app).post('/api/billing/checkout').set(authHeader()).send({ userId: 'attacker', priceId: 'price_other' });
  expect(response.status).toBe(200);
  expect(mockUser.plan).toBe('FREE');
  expect(checkout).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_test', client_reference_id: 'test-user',
    line_items: [{ price: 'price_pro', quantity: 1 }], cancel_url: 'http://localhost:5173/billing?checkout=canceled',
  }), expect.anything());
  // Visiting a canceled/success return URL is only a read; it cannot grant Pro.
  await request(app).get('/api/billing?checkout=success').set(authHeader());
  expect(mockUser.plan).toBe('FREE');
});
it('reuses an open checkout instead of creating another subscription', async () => {
  mockUser.stripeCheckoutSessionId = 'cs_open';
  checkoutRetrieve.mockResolvedValue({ status: 'open', url: 'https://checkout.stripe.com/existing' } as never);
  expect((await request(app).post('/api/billing/checkout').set(authHeader())).body.url).toContain('existing');
  expect(checkout).not.toHaveBeenCalled();
});
it('replaces an expired checkout with a new idempotency key and stays Free', async () => {
  mockUser.stripeCheckoutSessionId = 'cs_expired';
  checkoutRetrieve.mockResolvedValue({ status: 'expired' } as never);
  const response = await request(app).post('/api/billing/checkout').set(authHeader());
  expect(response.status).toBe(200);
  expect(checkout).toHaveBeenCalledWith(expect.anything(), { idempotencyKey: 'voltix-checkout-test-user-cs_expired' });
  expect(mockUser.plan).toBe('FREE');
});
it('waits for the webhook after a completed checkout instead of selling another subscription', async () => {
  mockUser.stripeCheckoutSessionId = 'cs_complete';
  checkoutRetrieve.mockResolvedValue({ status: 'complete' } as never);
  expect((await request(app).post('/api/billing/checkout').set(authHeader())).status).toBe(409);
  expect(checkout).not.toHaveBeenCalled();
  expect(mockUser.plan).toBe('FREE');
});
it('does not sell Pro again to an existing Pro user', async () => {
  mockUser.plan = 'PRO';
  expect((await request(app).post('/api/billing/checkout').set(authHeader())).status).toBe(409);
  expect(checkout).not.toHaveBeenCalled();
});
it('does not start another subscription while the current one needs payment', async () => {
  Object.assign(mockUser, { stripeSubscriptionId: 'sub_test', subscriptionStatus: 'past_due' });
  expect((await request(app).post('/api/billing/checkout').set(authHeader())).status).toBe(409);
  expect(checkout).not.toHaveBeenCalled();
});
it.each(['/api/billing/checkout', '/api/billing/portal'])('requires a session for %s', async path => {
  expect((await request(app).post(path)).status).toBe(401);
  expect(checkout).not.toHaveBeenCalled();
});
it('upgrades only after a signed webhook confirms the paid Pro subscription', async () => {
  expect((await postEvent()).status).toBe(200);
  expect(mockUser.plan).toBe('PRO');
  expect(mockUser.stripeSubscriptionId).toBe('sub_test');
});
it('allows another import after a signed payment upgrades a Free account at its project limit', async () => {
  mockTx.project.count.mockResolvedValue(1);
  await expect(assertProjectCapacity('test-user')).rejects.toMatchObject({ status: 402 });
  await postEvent();
  await expect(assertProjectCapacity('test-user')).resolves.toBeUndefined();
});
it('rejects unsigned and forged events before any subscription lookup or write', async () => {
  const body = eventBody();
  expect((await request(app).post('/api/billing/webhook').set('Content-Type', 'application/json').send(body)).status).toBe(400);
  expect((await request(app).post('/api/billing/webhook').set('Content-Type', 'application/json').set('Stripe-Signature', 'forged').send(body)).status).toBe(400);
  expect(retrieve).not.toHaveBeenCalled(); expect(mockUpdate).not.toHaveBeenCalled();
});
it('processes a duplicate event once', async () => {
  await postEvent(); await postEvent();
  expect(mockUpdate).toHaveBeenCalledTimes(1);
  expect(retrieve).toHaveBeenCalledTimes(1);
});
it.each(['invoice.payment_failed', 'customer.subscription.deleted'])('downgrades on %s without resetting usage', async type => {
  Object.assign(mockUser, { plan: 'PRO', stripeSubscriptionId: 'sub_test', chatMessagesUsed: 100 });
  retrieve.mockResolvedValue(subscription(type.startsWith('invoice') ? 'past_due' : 'canceled', false) as never);
  expect((await postEvent(type)).status).toBe(200);
  expect(mockUser.plan).toBe('FREE'); expect(mockUser.chatMessagesUsed).toBe(100);
});
it('does not grant Pro for unpaid or incomplete checkout', async () => {
  retrieve.mockResolvedValue(subscription('incomplete', false) as never);
  await postEvent(); expect(mockUser.plan).toBe('FREE');
});
it('reconciles a delayed payment failure with a now-paid subscription', async () => {
  await postEvent('invoice.payment_failed'); expect(mockUser.plan).toBe('PRO');
});
it('handles invoices sent using the older webhook subscription field', async () => {
  Object.assign(mockUser, { plan: 'PRO', stripeSubscriptionId: 'sub_test' });
  retrieve.mockResolvedValue(subscription('past_due', false) as never);
  const body = JSON.stringify({ id: 'evt_legacy_invoice', type: 'invoice.payment_failed', data: { object: { subscription: 'sub_test', customer: 'cus_test' } } });
  const response = await request(app).post('/api/billing/webhook').set('Content-Type', 'application/json')
    .set('Stripe-Signature', stripe.webhooks.generateTestHeaderString({ payload: body, secret: webhookSecret })).send(body);
  expect(response.status).toBe(200); expect(mockUser.plan).toBe('FREE');
});
it('ignores an old subscription termination after its replacement', async () => {
  Object.assign(mockUser, { plan: 'PRO', stripeSubscriptionId: 'sub_replacement' });
  await postEvent('customer.subscription.deleted');
  expect(mockUser.plan).toBe('PRO'); expect(retrieve).not.toHaveBeenCalled();
});
it('ignores a delayed checkout for an older subscription after its replacement', async () => {
  Object.assign(mockUser, { plan: 'PRO', stripeSubscriptionId: 'sub_replacement', subscriptionStatus: 'active' });
  await postEvent();
  expect(mockUser.stripeSubscriptionId).toBe('sub_replacement'); expect(retrieve).not.toHaveBeenCalled();
});
it('does not grant Pro for an unrelated paid price', async () => {
  const other = subscription(); other.items.data[0].price.id = 'price_other';
  retrieve.mockResolvedValue(other as never);
  await postEvent(); expect(mockUser.plan).toBe('FREE');
});
it('rejects a subscription belonging to another customer and leaves the event retryable', async () => {
  retrieve.mockResolvedValue({ ...subscription(), customer: 'cus_other' } as never);
  expect((await postEvent()).status).toBe(500);
  expect(mockUser.plan).toBe('FREE');
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(mockEvents.size).toBe(0);
});
it('ignores a signed event for an unknown customer without looking up their subscription', async () => {
  mockTx.user.findUnique.mockResolvedValueOnce(null as never);
  expect((await postEvent()).status).toBe(200);
  expect(retrieve).not.toHaveBeenCalled();
  expect(mockUpdate).not.toHaveBeenCalled();
});
it('retains Pro until a scheduled cancellation actually ends the paid subscription', async () => {
  Object.assign(mockUser, { plan: 'PRO', stripeSubscriptionId: 'sub_test' });
  retrieve.mockResolvedValue({ ...subscription(), cancel_at_period_end: true } as never);
  await postEvent('customer.subscription.updated');
  expect(mockUser.plan).toBe('PRO');
  retrieve.mockResolvedValue(subscription('canceled') as never);
  await postEvent('customer.subscription.deleted', 'evt_ended');
  expect(mockUser.plan).toBe('FREE');
});
it('retries failed processing instead of recording an unprocessed event', async () => {
  retrieve.mockRejectedValue(new Error('network failure'));
  expect((await postEvent()).status).toBe(500); expect(mockEvents.size).toBe(0);
  retrieve.mockResolvedValue(subscription() as never);
  expect((await postEvent()).status).toBe(200); expect(mockUser.plan).toBe('PRO');
});
