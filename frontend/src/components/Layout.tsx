import { NavLink, Link, Outlet, useLocation } from "react-router-dom";
import { useEffect } from "react";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="logo" aria-label="Retentra home">
      <span className="logo-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" width="20" height="20">
          <path d="M7 21c2.5-6 5-8 7-8s3 2 8-5" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" />
          <circle cx="23" cy="8.5" r="2.6" fill="#F2803A" />
        </svg>
      </span>
      {!compact && <span className="logo-text">Retentra</span>}
    </Link>
  );
}

export function AppHeader() {
  return (
    <header className="app-header container">
      <Logo />
      <nav aria-label="Main" className="pill-nav">
        <NavLink to="/dashboard" className={({ isActive }) => (isActive ? "pill active" : "pill")}>
          Dashboard
        </NavLink>
        <NavLink to="/predict" className={({ isActive }) => (isActive ? "pill active" : "pill")}>
          Predict
        </NavLink>
        <NavLink to="/model" className={({ isActive }) => (isActive ? "pill active" : "pill")}>
          Model
        </NavLink>
      </nav>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="site-footer container">
      <p>
        <strong>Retentra</strong> · Customer Churn Predictor with explainable AI · Built by Nimra Imran
      </p>
      <p className="muted">
        Model trained on the{" "}
        <a href="https://github.com/IBM/telco-customer-churn-on-icp4d" target="_blank" rel="noreferrer">
          IBM Telco Customer Churn
        </a>{" "}
        sample dataset (Apache 2.0). Predictions are estimates, not certainties.
      </p>
    </footer>
  );
}

export function AppLayout() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <AppHeader />
      <main id="main" tabIndex={-1} className="page-enter">
        <Outlet />
      </main>
      <Footer />
    </>
  );
}
