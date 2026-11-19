import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/authContext';
import { API_BASE_URL } from '../config';

type Limits = { chatMessages: number; savedProjects: number };
type Billing = {
  plan: 'FREE' | 'PRO'; month: string; limits: Limits;
  usage: Limits; remaining: Limits; plans: Record<'FREE' | 'PRO', Limits>;
  checkoutAvailable: boolean; canManageBilling: boolean;
  stripeMode: 'test' | 'live' | null;
};

export default function BillingPage() {
  const { apiFetch, logout } = useAuth();
  const [params] = useSearchParams();
  const checkout = params.get('checkout');
  const [billing, setBilling] = useState<Billing | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [waiting, setWaiting] = useState(checkout === 'success');
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await apiFetch(`${API_BASE_URL}/api/billing`, { signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load billing.');
    setBilling(data);
    setError('');
    return data as Billing;
  }, [apiFetch]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const refresh = async () => {
      try {
        const data = await load(controller.signal);
        if (checkout === 'success' && data.plan !== 'PRO' && ++attempts < 10) timer = setTimeout(() => void refresh(), 2000);
        else setWaiting(false);
      } catch (failure) {
        if (!controller.signal.aborted) {
          setError(failure instanceof Error ? failure.message : 'Unable to load billing.');
          setWaiting(false);
        }
      }
    };
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [checkout, load]);
  const openBilling = async (action: 'checkout' | 'portal') => {
    setPending(true);
    setError('');
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/billing/${action}`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to open billing.');
      window.location.assign(data.url);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to open billing.');
      setPending(false);
    }
  };
  return <div className="page">
    <header className="nav">
      <div className="logo"><span className="logo-badge" /><Link to="/dashboard">Voltix AI</Link></div>
      <div className="nav-actions"><Link className="btn btn-ghost" to="/dashboard">Dashboard</Link><button className="btn btn-ghost" onClick={logout}>Logout</button></div>
    </header>
    <main className="container billing-page">
      <h1>Plans and billing</h1><p className="muted">Choose the plan that fits your project work.</p>
      {billing?.stripeMode === 'test' && <p role="status">Test payments are enabled. No real money is charged.</p>}
      {checkout === 'canceled' && <p role="status">Checkout canceled. Your plan has not changed.</p>}
      {checkout === 'success' && billing?.plan !== 'PRO' && <p role="status">{waiting ? 'Confirming your payment...' : 'Payment confirmation may still be processing. Refresh to check your plan.'}</p>}
      {checkout === 'success' && billing?.plan === 'PRO' && <p role="status">Your Pro plan is active.</p>}
      {error && <div className="error-banner" role="alert">{error}</div>}
      {!billing && !error && <p role="status">Loading billing...</p>}
      {billing && <>
        <section className="card billing-usage">
          <h2>Current plan: {billing.plan === 'PRO' ? 'Pro' : 'Free'}</h2>
          <p>{billing.usage.chatMessages} / {billing.limits.chatMessages} chat messages used this month ({billing.month}, UTC).</p>
          <p>{billing.remaining.chatMessages} messages remaining. Usage resets at the start of each calendar month.</p>
          <p>{billing.usage.savedProjects} / {billing.limits.savedProjects} saved projects.</p>
          <p className="muted">Opening files, searching, and browsing your project do not use messages.</p>
        </section>
        <div className="billing-plans">{(['FREE', 'PRO'] as const).map(plan => <section className="card" key={plan}>
          <h2>{plan === 'PRO' ? 'Pro' : 'Free'} {billing.plan === plan && <span className="pill">Current plan</span>}</h2>
          <p>{billing.plans[plan].chatMessages} chat messages per month</p>
          <p>{billing.plans[plan].savedProjects} saved {billing.plans[plan].savedProjects === 1 ? 'project' : 'projects'}</p>
          {plan === 'PRO' && billing.plan === 'FREE' && <>
            <p className="muted">Subscription price and billing terms are shown at checkout.</p>
            <button className="btn btn-primary" disabled={pending || !billing.checkoutAvailable} onClick={() => void openBilling('checkout')}>Upgrade to Pro</button>
            {!billing.checkoutAvailable && <p className="muted">Pro checkout is currently unavailable.</p>}
          </>}
        </section>)}</div>
        {billing.canManageBilling && <button className="btn btn-ghost" disabled={pending} onClick={() => void openBilling('portal')}>Manage subscription</button>}
      </>}
      <button className="btn btn-ghost" disabled={pending || waiting} onClick={() => void load().catch(failure => setError(failure instanceof Error ? failure.message : 'Unable to load billing.'))}>Refresh billing</button>
    </main>
  </div>;
}
