import { Link } from "react-router-dom";
import { ArrowRight, BarChart3, ClipboardList, Gauge, LineChart, MessageSquareHeart, ShieldCheck, Sparkles } from "lucide-react";
import { api } from "../lib/api";
import { num, pct } from "../lib/format";
import { useApi } from "../lib/useApi";
import { Footer, Logo } from "../components/Layout";
import { HeroScene } from "../components/three/HeroScene";

export function LandingPage() {
  const { data: a } = useApi(api.analytics);
  const m = a?.test_metrics;

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="landing-nav container">
        <Logo />
        <nav aria-label="Landing" className="landing-links">
          <a href="#how">How it works</a>
          <a href="#features">Features</a>
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/model">Model</Link>
        </nav>
        <Link to="/predict" className="btn btn-primary btn-sm">
          Get started
        </Link>
      </header>

      <main id="main" tabIndex={-1}>
        <section className="hero container" aria-labelledby="hero-title">
          <div className="hero-copy rise">
            <span className="pill-tag">
              <Sparkles size={14} aria-hidden="true" /> Explainable AI for customer retention
            </span>
            <h1 id="hero-title">Know which customers will leave — and why.</h1>
            <p className="hero-sub">
              ChurnSight scores each customer's chance of leaving, shows the exact factors behind the score with SHAP, and suggests practical
              ways to keep them. No sign-up: open it and start.
            </p>
            <div className="hero-ctas">
              <Link to="/predict" className="btn btn-primary">
                Get started <ArrowRight size={17} aria-hidden="true" />
              </Link>
              <Link to="/dashboard" className="btn btn-glass">
                Explore the dashboard
              </Link>
            </div>
            <dl className="hero-stats">
              <div>
                <dt>Customers analysed</dt>
                <dd>{a ? num(a.totals.customers) : "—"}</dd>
              </div>
              <div>
                <dt>ROC-AUC (held-out)</dt>
                <dd>{m ? m.roc_auc.toFixed(3) : "—"}</dd>
              </div>
              <div>
                <dt>Churners caught</dt>
                <dd>{m ? pct(m.recall) : "—"}</dd>
              </div>
            </dl>
          </div>
          <div className="hero-visual">
            <HeroScene analytics={a} />
          </div>
        </section>

        <section id="how" className="container section" aria-labelledby="how-title">
          <span className="eyebrow">How it works</span>
          <h2 id="how-title" className="section-title">
            From customer details to a clear next step
          </h2>
          <ol className="steps">
            <li className="glass step rise">
              <span className="step-num">1</span>
              <ClipboardList size={22} aria-hidden="true" />
              <h3>Enter a customer</h3>
              <p>Contract, tenure, services and billing — the same 18 details the model was trained on. Or pick a demo customer.</p>
            </li>
            <li className="glass step rise" style={{ animationDelay: "0.08s" }}>
              <span className="step-num">2</span>
              <Gauge size={22} aria-hidden="true" />
              <h3>Get a churn score</h3>
              <p>A trained machine-learning model estimates the probability the customer leaves and places them in a Low, Medium or High risk band.</p>
            </li>
            <li className="glass step rise" style={{ animationDelay: "0.16s" }}>
              <span className="step-num">3</span>
              <MessageSquareHeart size={22} aria-hidden="true" />
              <h3>See why, then act</h3>
              <p>SHAP shows which factors raised or lowered the score, and the retention engine turns them into prioritised actions.</p>
            </li>
          </ol>
        </section>

        <section id="features" className="container section" aria-labelledby="feat-title">
          <span className="eyebrow">Capabilities</span>
          <h2 id="feat-title" className="section-title">
            Prediction, explanation and action in one place
          </h2>
          <div className="features">
            <article className="navy feature">
              <LineChart size={24} aria-hidden="true" />
              <h3>Churn prediction</h3>
              <p>
                A model chosen by cross-validation from four candidates, with a decision threshold tuned to catch more customers who leave.
              </p>
              {m && (
                <ul className="feature-facts">
                  <li>
                    <strong>{m.roc_auc.toFixed(3)}</strong> ROC-AUC
                  </li>
                  <li>
                    <strong>{pct(m.recall)}</strong> recall
                  </li>
                  <li>
                    <strong>{pct(m.precision)}</strong> precision
                  </li>
                </ul>
              )}
            </article>
            <article className="glass feature">
              <BarChart3 size={24} aria-hidden="true" />
              <h3>SHAP explanations</h3>
              <p>
                Every prediction comes with the factors that pushed it up or down, a waterfall chart, and a plain-language summary. Checked so
                the contributions always add up to the score.
              </p>
            </article>
            <article className="glass feature">
              <ShieldCheck size={24} aria-hidden="true" />
              <h3>Retention suggestions</h3>
              <p>
                Actions are only suggested when the customer's own data and the model's explanation support them, each with its evidence and
                the assumption behind it.
              </p>
            </article>
          </div>
        </section>

        <section className="container section" aria-labelledby="honest-title">
          <div className="glass honest">
            <div>
              <span className="eyebrow">Honest by design</span>
              <h2 id="honest-title" className="section-title">
                Clear about what the model can and can't tell you
              </h2>
            </div>
            <ul>
              <li>Trained on IBM's public Telco Customer Churn sample data (fictional customers, Apache 2.0).</li>
              <li>Scores are probabilities from historical patterns, not certainties.</li>
              <li>SHAP explains how the model behaves; it doesn't prove why a customer leaves.</li>
              <li>Suggestions are starting points for your team, never guarantees.</li>
            </ul>
          </div>
        </section>

        <section className="container section cta-band" aria-labelledby="cta-title">
          <div className="navy cta-card">
            <h2 id="cta-title">Ready to check a customer?</h2>
            <p className="muted">It takes under a minute, and a demo customer is one click away.</p>
            <Link to="/predict" className="btn btn-white">
              Start a prediction <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
