import 'dotenv/config';
import { checkStripeSetup } from '../billing/checkSetup';
import { stripeClient, stripeMode } from '../billing/stripe';

async function main() {
  const args = process.argv.slice(2);
  const localListener = args.includes('--local-listener');
  const urlIndex = args.indexOf('--webhook-url');
  const webhookUrl = urlIndex < 0 ? undefined : args[urlIndex + 1];
  const required = ['STRIPE_SECRET_KEY', 'STRIPE_PRO_PRICE_ID', 'STRIPE_WEBHOOK_SECRET', 'FRONTEND_URL'];
  const missing = required.filter(name => !process.env[name] || /replace_me/.test(process.env[name]!));
  if (missing.length) throw new Error(`Configure these backend variables first: ${missing.join(', ')}.`);
  const mode = stripeMode();
  if (!mode) throw new Error('STRIPE_SECRET_KEY must be a Stripe test/live secret or restricted key.');
  if (mode === 'live' && !args.includes('--live')) throw new Error('This check expects test mode. Use a test key, or pass --live to inspect live configuration.');
  const frontend = new URL(process.env.FRONTEND_URL!);
  if (!['http:', 'https:'].includes(frontend.protocol) || frontend.username || frontend.password
    || (frontend.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(frontend.hostname))) {
    throw new Error('FRONTEND_URL must use HTTPS, except for localhost development.');
  }
  if (!localListener) {
    if (!webhookUrl) throw new Error('Pass --webhook-url https://YOUR_API/api/billing/webhook, or --local-listener for Stripe CLI forwarding.');
    const endpoint = new URL(webhookUrl);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.pathname !== '/api/billing/webhook'
      || endpoint.search || endpoint.hash) throw new Error('Use the exact public HTTPS /api/billing/webhook URL.');
  }
  const result = await checkStripeSetup(stripeClient(), { priceId: process.env.STRIPE_PRO_PRICE_ID!, mode, localListener, webhookUrl });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

void main().catch(error => {
  // Stripe errors can echo key fragments. Only our preflight messages are printed.
  console.error(error instanceof Error && !('type' in error) && !(error instanceof TypeError)
    ? error.message : 'Unable to check Stripe setup. Verify backend configuration, API access and key permissions.');
  process.exitCode = 1;
});
