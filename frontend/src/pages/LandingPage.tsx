import { Link } from 'react-router-dom';

export default function LandingPage() {
  return (
    <div className="page">
      <header className="nav">
        <div className="logo">
          <span className="logo-badge" />
          <span>Voltix AI</span>
        </div>
        <div className="nav-actions">
          <Link className="btn btn-ghost" to="/auth">Sign in</Link>
        </div>
      </header>

      <main className="container">
        <section className="hero">
          <div>
            <p className="eyebrow">Voltix AI · Code Clarity Platform</p>
            <h1>Turn messy codebases into clear, navigable systems.</h1>
            <p className="lead">
              Voltix explains files, maps dependencies, and highlights maintainability risks so teams can ship with
              confidence.
            </p>
            <div className="hero-actions">
              <Link className="btn btn-primary" to="/auth">Get Started</Link>
              <button className="btn btn-ghost" type="button">Watch Demo</button>
            </div>
            <div className="chip-row">
              <span className="chip">Architecture maps</span>
              <span className="chip">AI file explanations</span>
              <span className="chip">Refactor risk insights</span>
            </div>
          </div>
          <div className="card card-glow">
            <div className="card-title">Live Analysis</div>
            <div className="stat-large">1,284 files</div>
            <div className="stat-sub">3,917 functions · 47 hotspots</div>
            <div className="preview-image" aria-hidden="true" />
          </div>
        </section>

        <section className="card wide-card">
          <div className="card-title">About Voltix AI</div>
          <p>
            We built Voltix for teams inheriting complex software. It accelerates onboarding, improves docs, and gives
            maintainers clarity across the whole workspace.
          </p>
          <div className="chip-row">
            <span className="chip">Code Explorer</span>
            <span className="chip">Maintainability Signals</span>
            <span className="chip">Team Alignment</span>
          </div>
        </section>

        <section>
          <h2 className="section-title">What You Get</h2>
          <div className="feature-grid">
            <article className="card">
              <h3>Code Explorer</h3>
              <p>Traverse folders, inspect files, and instantly view explanations with dependency context.</p>
            </article>
            <article className="card">
              <h3>Maintainability Signals</h3>
              <p>Find risky modules, stale docs, and complexity hotspots before changes hit production.</p>
            </article>
            <article className="card">
              <h3>Team Alignment</h3>
              <p>Share insights, function-level notes, and architecture decisions in one workspace.</p>
            </article>
          </div>
        </section>
      </main>
    </div>
  );
}
