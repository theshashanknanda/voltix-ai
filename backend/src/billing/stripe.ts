import Stripe from 'stripe';
import { HttpError } from '../errors';

export function stripeMode(key = process.env.STRIPE_SECRET_KEY): 'test' | 'live' | null {
  if (/^(sk|rk)_test_/.test(key ?? '')) return 'test';
  if (/^(sk|rk)_live_/.test(key ?? '')) return 'live';
  return null;
}

export function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new HttpError(503, 'Billing is not available yet. Please try again later.');
  return new Stripe(key, { timeout: 10_000, maxNetworkRetries: 0 });
}

export function proPriceId(): string {
  const price = process.env.STRIPE_PRO_PRICE_ID;
  if (!price) throw new HttpError(503, 'Pro checkout is not available yet.');
  return price;
}

export function frontendOrigin(): string {
  const origin = process.env.FRONTEND_URL;
  if (!origin) throw new HttpError(503, 'Billing is not configured yet.');
  return new URL(origin).origin;
}
