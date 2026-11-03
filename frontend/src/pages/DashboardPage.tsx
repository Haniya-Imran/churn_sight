import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { api } from "../lib/api";
import { num, pct, usd, usdShort } from "../lib/format";
import type { RiskCustomer } from "../lib/types";
import { useApi } from "../lib/useApi";
import { Donut, RateBars, TenureArea } from "../components/charts";
import { ErrorState, LoadingBlock } from "../components/States";
import { Tooltip } from "../components/Tooltip";
import { Podium } from "../components/three/Podium";

const PAGE = 8;

export function DashboardPage() {
  const { data: a, error, loading, retry } = useApi(api.analytics);
  const navigate = useNavigate();
  const [shown, setShown] = useState(PAGE);

  const analyse = (c: RiskCustomer) => navigate("/predict", { state: { customer: c.features, label: `#${c.customer_id}` } });

  return (
    <div className="container page">
      <div className="page-title">
        <div>
          <h1>Churn Dashboard</h1>
          <p className="muted">How many customers are leaving, and why, across the full IBM Telco dataset.</p>
        </div>
        {a && <span className="chip">{num(a.totals.customers)} customers · real data</span>}
      </div>

      {loading && <LoadingBlock label="Loading dashboard" height={520} />}
      {error && <ErrorState title="Dashboard data isn't available" error={error} onRetry={retry} />}

      {a && (
        <>
          <div className="dash-stage">
            <div className="dash-col">
              <section className="glass dash-card tilt-left rise" aria-labelledby="c-contract">
                <h2 id="c-contract" className="card-title small">
                  Churned customers by contract
                </h2>
                <div className="donut-row">
                  <Donut
                    size={104}
                    label={`Of churned customers: ${a.churned_share_by_contract.map((s) => `${s.group} ${pct(s.share)}`).join(", ")}`}
                    segments={a.churned_share_by_contract.map((s, i) => ({ name: s.group, value: s.share, color: ["#F2803A", "#4A63F0", "#1E2A5E"][i] }))}
                  />
                  <ul className="legend">
                    {a.churned_share_by_contract.map((s, i) => (
                      <li key={s.group}>
                        <i style={{ background: ["#F2803A", "#4A63F0", "#1E2A5E"][i] }} />
                        {s.group} <strong>{pct(s.share)}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
              <section className="glass dash-card tilt-left rise" style={{ animationDelay: "0.1s" }} aria-labelledby="c-internet">
                <h2 id="c-internet" className="card-title small">
                  Churn rate by internet service
                </h2>
                <RateBars
                  rows={a.churn_by_internet.map((r) => ({ label: r.group === "No" ? "No internet" : r.group, value: r.churn_rate, detail: `${num(r.churned)} of ${num(r.customers)}` }))}
                  highlight={(_, v) => v > a.totals.churn_rate}
                />
              </section>
            </div>

            <div className="dash-center">
              <div className="dash-podium" aria-hidden="true">
                <div className="dash-podium-scene">
                  <Podium size={460} />
                </div>
              </div>
              <section className="navy overview-card rise" aria-labelledby="c-overview">
                <div className="overview-head">
                  <h2 id="c-overview" className="card-title">
                    Churn Overview
                  </h2>
                  <span className="hs-chip">All {num(a.totals.customers)} customers</span>
                </div>
                <div className="overview-panel">
                  <div className="overview-kpi">
                    <span className="muted">Churn rate</span>
                    <strong>{pct(a.totals.churn_rate, 1)}</strong>
                    <span className="kpi-sub">{num(a.totals.churned)} customers left</span>
                  </div>
                  <div className="overview-chart">
                    <span className="muted small">Churn rate by tenure (months)</span>
                    <TenureArea rows={a.churn_by_tenure_band} />
                  </div>
                </div>
                <div className="overview-tiles">
                  <div>
                    <span>Customers</span>
                    <strong>{num(a.totals.customers)}</strong>
                  </div>
                  <div className="warm">
                    <span>Churned</span>
                    <strong>{num(a.totals.churned)}</strong>
                  </div>
                  <div>
                    <span>
                      Monthly revenue lost
                      <Tooltip text={`Sum of monthly charges of customers who churned (${usd(a.totals.monthly_revenue_churned_customers)}).`} label="About revenue lost" />
                    </span>
                    <strong>{usdShort(a.totals.monthly_revenue_churned_customers)}</strong>
                  </div>
                  <div>
                    <span>Avg tenure</span>
                    <strong>{Math.round(a.totals.avg_tenure_months)} mo</strong>
                  </div>
                </div>
              </section>
            </div>

            <div className="dash-col">
              <section className="glass dash-card tilt-right rise" aria-labelledby="c-drivers">
                <div className="why-head">
                  <h2 id="c-drivers" className="card-title small">
                    Top churn drivers
                  </h2>
                  <Tooltip text="Average absolute SHAP value per factor on held-out customers: how much each factor moves the model's predictions overall." label="About churn drivers" />
                </div>
                <RateBars
                  rows={a.global_importance.slice(0, 5).map((g) => ({ label: g.label, value: g.mean_abs_shap / a.global_importance[0].mean_abs_shap }))}
                  highlight={(_, v) => v === 1}
                  max={1}
                />
                <p className="tiny muted">Relative SHAP importance (largest = 100%).</p>
              </section>
              {a.top_risk_customers[0] && (
                <section className="navy dash-card tilt-right rise" style={{ animationDelay: "0.1s" }} aria-labelledby="c-top">
                  <h2 id="c-top" className="muted small-label">
                    Highest risk · #{a.top_risk_customers[0].customer_id}
                  </h2>
                  <div className="overview-head">
                    <strong className="big-num">{pct(a.top_risk_customers[0].probability)}</strong>
                    <span className="badge badge-High">High risk</span>
                  </div>
                  <span className="meter">
                    <span style={{ width: pct(a.top_risk_customers[0].probability), background: "linear-gradient(90deg,#FFB37E,#F2803A)" }} />
                  </span>
                  <button type="button" className="btn btn-white" onClick={() => analyse(a.top_risk_customers[0])}>
                    Open in Predict <ArrowRight size={16} aria-hidden="true" />
                  </button>
                </section>
              )}
            </div>
          </div>

          <div className="dash-row">
            <div className="dash-stack">
            <section className="glass panel" aria-labelledby="c-bands">
              <div className="panel-head">
                <div>
                  <h2 id="c-bands" className="card-title">
                    Risk bands on held-out customers
                  </h2>
                  <p className="muted">The model scored {num(a.test_set.customers)} customers it never saw in training.</p>
                </div>
              </div>
              <div className="band-grid">
                {(["High", "Medium", "Low"] as const).map((b) => (
                  <div key={b} className={`band-tile band-${b}`}>
                    <span className={`badge badge-${b}`}>{b} risk</span>
                    <strong>{num(a.test_set.band_counts[b])}</strong>
                    <span className="muted">customers</span>
                    <span className="band-actual">
                      {pct(a.test_set.actual_churn_rate_by_band[b])} actually churned
                    </span>
                  </div>
                ))}
              </div>
              <p className="tiny muted">
                Bands: Low below {pct(a.threshold, 1)}, Medium {pct(a.threshold, 1)}–{pct(a.high_risk_cutoff)}, High {pct(a.high_risk_cutoff)} and above.
              </p>
            </section>
            <section className="glass panel" aria-labelledby="c-pay">
              <h2 id="c-pay" className="card-title">
                Churn rate by payment method
              </h2>
              <RateBars
                rows={a.churn_by_payment.map((r) => ({ label: r.group, value: r.churn_rate, detail: `${num(r.churned)} of ${num(r.customers)} customers` }))}
                highlight={(_, v) => v > a.totals.churn_rate}
              />
              <h2 className="card-title small">Churn rate by tech support</h2>
              <RateBars
                rows={a.churn_by_tech_support.map((r) => ({ label: r.group === "Yes" ? "Has tech support" : r.group === "No" ? "No tech support" : r.group, value: r.churn_rate, detail: `${num(r.churned)} of ${num(r.customers)} customers` }))}
                highlight={(_, v) => v > a.totals.churn_rate}
              />
              <p className="tiny muted">Orange bars are above the overall churn rate of {pct(a.totals.churn_rate, 1)}.</p>
            </section>
            </div>

            <section className="glass panel" aria-labelledby="c-compare">
              <div className="panel-head">
                <div>
                  <h2 id="c-compare" className="card-title">
                    High-risk vs low-risk customers
                  </h2>
                  <p className="muted">
                    What the {num(a.high_vs_low_risk.high_risk_customers)} high-risk and {num(a.high_vs_low_risk.low_risk_customers)} low-risk test customers look like.
                  </p>
                </div>
              </div>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Characteristic</th>
                      <th scope="col">High risk</th>
                      <th scope="col">Low risk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.keys(a.high_vs_low_risk.high).map((k) => {
                      const h = a.high_vs_low_risk.high[k];
                      const l = a.high_vs_low_risk.low[k];
                      const isShare = !k.startsWith("Average");
                      const f = (v: number) => (isShare ? pct(v) : k.includes("USD") ? usd(v) : `${v} mo`);
                      return (
                        <tr key={k}>
                          <th scope="row">{k.replace(" (USD)", "").replace(" (months)", "")}</th>
                          <td className="strong-cell">{f(h)}</td>
                          <td>{f(l)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <section className="glass panel table-panel" aria-labelledby="c-risk">
            <div className="panel-head">
              <div>
                <h2 id="c-risk" className="card-title">
                  Customers at Risk
                </h2>
                <p className="muted">Highest model scores among held-out test customers, sorted by risk.</p>
              </div>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Customer</th>
                    <th scope="col">Tenure</th>
                    <th scope="col">Contract</th>
                    <th scope="col">Internet</th>
                    <th scope="col">Monthly bill</th>
                    <th scope="col">Risk</th>
                    <th scope="col">
                      Actually churned
                      <Tooltip text="The known outcome from the dataset, shown so you can judge the model. A new customer's outcome would not be known." label="About actual outcome" />
                    </th>
                    <th scope="col">
                      <span className="sr-only">Action</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {a.top_risk_customers.slice(0, shown).map((c) => (
                    <tr key={c.customer_id}>
                      <th scope="row">#{c.customer_id}</th>
                      <td>{c.features.tenure} mo</td>
                      <td>{c.features.Contract}</td>
                      <td>{c.features.InternetService}</td>
                      <td>{usd(c.features.MonthlyCharges)}</td>
                      <td>
                        <span className={`badge badge-${c.band}`}>{pct(c.probability)}</span>
                      </td>
                      <td>{c.actual_churn ? "Yes" : "No"}</td>
                      <td>
                        <button type="button" className="btn btn-glass btn-sm" onClick={() => analyse(c)} aria-label={`Analyse customer ${c.customer_id}`}>
                          Analyse
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {shown < a.top_risk_customers.length && (
              <button type="button" className="btn btn-glass btn-sm table-more" onClick={() => setShown((s) => s + PAGE)}>
                Show more ({a.top_risk_customers.length - shown} left)
              </button>
            )}
          </section>
          <p className="tiny muted source-note">{a.source}</p>
        </>
      )}
    </div>
  );
}
