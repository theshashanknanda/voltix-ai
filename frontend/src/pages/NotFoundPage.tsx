import { Link } from 'react-router-dom';
import { useAuth } from '../auth/authContext';

export default function NotFoundPage() {
  const { isAuthenticated } = useAuth();
  const nextPath = isAuthenticated ? '/dashboard' : '/';
  const nextLabel = isAuthenticated ? 'Go to dashboard' : 'Go to landing';

  return (
    <div className="page">
      <header className="nav">
        <div className="logo">
          <span className="logo-badge" />
          <Link to={nextPath}>Voltix AI</Link>
        </div>
        <div className="nav-actions">
          <Link className="btn btn-ghost" to="/">Landing</Link>
          <Link className="btn btn-ghost" to="/auth">Auth</Link>
          <Link className="btn btn-ghost" to="/dashboard">Dashboard</Link>
        </div>
      </header>

      <main className="container">
        <section className="card">
          <h1>404</h1>
          <p className="muted">We could not find that page.</p>
          <Link className="btn btn-primary" to={nextPath}>{nextLabel}</Link>
        </section>
      </main>
    </div>
  );
}
