import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function AuthPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    const action = mode === 'login' ? login : register;
    const result = await action(email, password);

    if (result.ok) {
      navigate('/dashboard');
    } else {
      setError(result.error);
    }

    setLoading(false);
  };

  return (
    <div className="page auth-page">
      <header className="nav">
        <div className="logo">
          <span className="logo-badge" />
          <Link to="/">Voltix AI</Link>
        </div>
        <div className="nav-actions">
          <span className="eyebrow">Login & Signup</span>
        </div>
      </header>

      <main className="container auth-layout">
        <section className="card auth-left">
          <h1>Welcome back to Voltix</h1>
          <p>
            Securely access code insights, team workspaces, and historical analysis reports.
          </p>
          <div className="preview-image wide" aria-hidden="true" />
          <ul className="checklist">
            <li>Project-level role access</li>
            <li>Encrypted workspace sessions</li>
            <li>SSO ready (future)</li>
          </ul>
        </section>

        <section className="card auth-right">
          <div className="tab-row">
            <button
              type="button"
              className={`tab ${mode === 'login' ? 'active' : ''}`}
              onClick={() => setMode('login')}
            >
              Login
            </button>
            <button
              type="button"
              className={`tab ${mode === 'signup' ? 'active' : ''}`}
              onClick={() => setMode('signup')}
            >
              Signup
            </button>
          </div>

          <form className="auth-form" onSubmit={submit}>
            <button type="button" className="btn btn-ghost" disabled>
              Continue with Google
            </button>

            <input
              className="input"
              type="email"
              placeholder="Work email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <input
              className="input"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />

            {mode === 'signup' && (
              <input
                className="input"
                type="text"
                placeholder="Full name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
              />
            )}

            {error && <div className="error-banner">{error}</div>}

            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? 'Working...' : mode === 'login' ? 'Login' : 'Create Account'}
            </button>
          </form>
          <p className="helper-text">Auth powered by JWT (email + password).</p>
        </section>
      </main>
    </div>
  );
}
