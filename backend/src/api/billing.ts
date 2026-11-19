import { Router } from 'express';
import { prisma } from '../database/prismaClient';
import requireAuth, { AuthenticatedRequest } from '../middleware/requireAuth';
import { getBillingUsage, PLAN_LIMITS } from '../billing/quotas';
import { stripeClient, proPriceId, frontendOrigin, stripeMode } from '../billing/stripe';
import { HttpError, respondError } from '../errors';

const router = Router();
router.get('/billing', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    res.json({ ...await getBillingUsage(req.user!.id), plans: PLAN_LIMITS, stripeMode: stripeMode(),
      checkoutAvailable: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRO_PRICE_ID && process.env.STRIPE_WEBHOOK_SECRET && process.env.FRONTEND_URL),
    });
  } catch (error) { respondError(res, error, 'Unable to load billing.'); }
});

router.post('/billing/checkout', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (user.plan === 'PRO') throw new HttpError(409, 'Your account already has Pro.');
    if (user.stripeSubscriptionId && !['canceled', 'incomplete_expired'].includes(user.subscriptionStatus ?? '')) {
      throw new HttpError(409, 'You already have a subscription. Manage billing to update your payment method.');
    }
    const stripe = stripeClient();
    const price = proPriceId();
    const origin = frontendOrigin();
    if (!process.env.STRIPE_WEBHOOK_SECRET) throw new HttpError(503, 'Pro checkout is not available yet.');
    if (user.stripeCheckoutSessionId) {
      const pending = await stripe.checkout.sessions.retrieve(user.stripeCheckoutSessionId);
      if (pending.status === 'open' && pending.url) { res.json({ url: pending.url }); return; }
      if (pending.status === 'complete' && !user.stripeSubscriptionId) {
        throw new HttpError(409, 'Your payment is being confirmed. Please refresh Billing shortly.');
      }
    }
    const customerId = user.stripeCustomerId ?? (await stripe.customers.create({
      email: user.email, metadata: { userId: user.id },
    }, { idempotencyKey: `voltix-customer-${user.id}` })).id;
    await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customerId } });
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription', customer: customerId, line_items: [{ price, quantity: 1 }],
      client_reference_id: user.id, metadata: { userId: user.id },
      subscription_data: { metadata: { userId: user.id } },
      success_url: `${origin}/billing?checkout=success`, cancel_url: `${origin}/billing?checkout=canceled`,
    }, { idempotencyKey: `voltix-checkout-${user.id}-${user.stripeCheckoutSessionId ?? 'initial'}` });
    await prisma.user.update({ where: { id: user.id }, data: { stripeCheckoutSessionId: session.id } });
    if (!session.url) throw new HttpError(409, 'Your checkout is being confirmed. Please refresh Billing shortly.');
    res.json({ url: session.url });
  } catch (error) { respondError(res, error, 'Unable to start checkout. Please try again.'); }
});

router.post('/billing/portal', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!user.stripeCustomerId) throw new HttpError(400, 'No billing account exists yet.');
    const session = await stripeClient().billingPortal.sessions.create({ customer: user.stripeCustomerId, return_url: `${frontendOrigin()}/billing` });
    res.json({ url: session.url });
  } catch (error) { respondError(res, error, 'Unable to open billing management.'); }
});
export default router;
