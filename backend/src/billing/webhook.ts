import Stripe from 'stripe';
import { Request, Response } from 'express';
import { prisma } from '../database/prismaClient';
import { stripeClient, proPriceId } from './stripe';
import { respondError } from '../errors';

const objectId = (value: string | { id: string } | null | undefined) => typeof value === 'string' ? value : value?.id;

function subscriptionFor(event: Stripe.Event): string | undefined {
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    return objectId((event.data.object as Stripe.Checkout.Session).subscription);
  }
  if (event.type.startsWith('customer.subscription.')) return (event.data.object as Stripe.Subscription).id;
  if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as Stripe.Invoice & { subscription?: string | Stripe.Subscription | null };
    // Older webhook API versions placed subscription directly on the invoice.
    return objectId(invoice.parent?.subscription_details?.subscription ?? invoice.subscription);
  }
  return undefined;
}

const HANDLED_EVENTS = new Set([
  'checkout.session.completed', 'checkout.session.async_payment_succeeded',
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
  'invoice.paid', 'invoice.payment_failed',
]);

export async function stripeWebhook(req: Request, res: Response): Promise<void> {
  const signature = req.headers['stripe-signature'];
  if (typeof signature !== 'string' || !Buffer.isBuffer(req.body)) {
    res.status(400).json({ error: 'Invalid Stripe signature.' });
    return;
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) { res.status(503).json({ error: 'Billing webhook is not configured.' }); return; }
  let stripe: Stripe;
  try { stripe = stripeClient(); } catch (error) { respondError(res, error, 'Billing is unavailable.'); return; }
  let event: Stripe.Event;
  try { event = stripe.webhooks.constructEvent(req.body, signature, secret); }
  catch { res.status(400).json({ error: 'Invalid Stripe signature.' }); return; }
  if (!HANDLED_EVENTS.has(event.type)) { res.json({ received: true }); return; }

  const subscriptionId = subscriptionFor(event);
  const customerId = objectId((event.data.object as { customer?: string | { id: string } }).customer);
  if (!subscriptionId || !customerId) { res.json({ received: true }); return; }
  try {
    const user = await prisma.user.findUnique({ where: { stripeCustomerId: customerId } });
    if (!user) { res.json({ received: true }); return; }
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${user.id} FOR UPDATE`;
      if (await tx.stripeEvent.findUnique({ where: { id: event.id } })) return;
      const current = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      const isCheckout = event.type.startsWith('checkout.session.');
      // A late notice about a previous subscription must not revoke its replacement.
      const canReplace = isCheckout && ['canceled', 'incomplete_expired'].includes(current.subscriptionStatus ?? '');
      if (!current.stripeSubscriptionId || current.stripeSubscriptionId === subscriptionId || canReplace) {
        // Reconcile with Stripe while holding the user's lock. Signed events can
        // be delivered out of order, including an old failure after recovery.
        const subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['latest_invoice'] });
        const invoice = subscription.latest_invoice;
        const paid = invoice !== null && typeof invoice !== 'string' && invoice.status === 'paid';
        const correctPrice = subscription.items.data.some(item => item.price.id === proPriceId());
        const belongsToUser = objectId(subscription.customer) === customerId
          && (!subscription.metadata.userId || subscription.metadata.userId === user.id);
        if (!belongsToUser) throw new Error('Subscription ownership mismatch');
        const pro = subscription.status === 'active' && paid && correctPrice;
        await tx.user.update({ where: { id: user.id }, data: {
          plan: pro ? 'PRO' : 'FREE', stripeSubscriptionId: subscription.id,
          subscriptionStatus: subscription.status,
        } });
      }
      await tx.stripeEvent.create({ data: { id: event.id } });
    }, { timeout: 20_000 });
    res.json({ received: true });
  } catch (error) {
    // Non-2xx asks Stripe to retry; failed processing is never recorded as done.
    respondError(res, error, 'Unable to process billing event.');
  }
}
