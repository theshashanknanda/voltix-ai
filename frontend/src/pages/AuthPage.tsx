import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/authContext';

export default function AuthPage() {
  const { login, error, configured } = useAuth();
  const [failure, setFailure] = useState('');
  const [pending, setPending] = useState(false);
  const signIn = async (provider: 'google-oauth2' | 'github') => {
    setPending(true);
    setFailure('');
    const result = await login(provider);
    if (!result.ok) { setFailure(result.error); setPending(false); }
  };
  return <div className="page auth-page">
    <header className="nav"><div className="logo"><span className="logo-badge" /><Link to="/">Voltix AI</Link></div></header>
    <main className="container auth-layout">
      <section className="card auth-left">
        <h1>Understand your code with Voltix</h1>
        <p>Sign in to explore projects, review code, and keep your analyses together.</p>
        <ul className="checklist"><li>Browse your imported projects</li><li>Get explanations with context</li><li>Save useful insights</li></ul>
      </section>
      <section className="card auth-right">
        <h2>Welcome to Voltix AI</h2>
        <p className="muted">Choose an account to continue.</p>
        {(failure || error) && <div className="error-banner" role="alert">{failure || error}</div>}
        <div className="auth-form">
          <button className="btn btn-primary" type="button" disabled={pending || !configured} onClick={() => void signIn('google-oauth2')}>Continue with Google</button>
          <button className="btn btn-ghost" type="button" disabled={pending || !configured} onClick={() => void signIn('github')}>Continue with GitHub</button>
        </div>
        {pending && <p role="status">Opening secure sign-in...</p>}
      </section>
    </main>
  </div>;
}
