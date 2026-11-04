import { useEffect, useMemo, useRef, useState } from "react";
import { pct, num } from "../../lib/format";
import type { Analytics } from "../../lib/types";
import { Donut, TenureArea } from "../charts";
import { Pie3D, Podium } from "./Podium";
import { supports3D, usePrefersReducedMotion, useTilt } from "./useTilt";

const REST = { x: -10, y: -14 };
const DESIGN_WIDTH = 840; // the scene's natural width (see .hero-stage)

/** Scale factor so the whole scene fits its column without cards being cut off. */
function useFit() {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      // On wide layouts the scene may extend slightly into the page gutter.
      const bleed = window.innerWidth >= 1000 ? 40 : 0;
      setFit(Math.min(1, (el.clientWidth + bleed) / DESIGN_WIDTH));
    };
    update();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);
  return { ref, fit };
}

/**
 * Landing-page 3D scene modelled on the 3D.jpg reference: a central analytics
 * screen on a glowing podium, surrounded by floating glass panels and a 3D pie.
 * Every number comes from the real dataset (via the API). Drag to rotate; it
 * springs back on release. Falls back to a flat layout without 3D support and
 * stays still when the user prefers reduced motion.
 */
export function HeroScene({ analytics }: { analytics: Analytics | null }) {
  const reduced = usePrefersReducedMotion();
  const has3D = useMemo(supports3D, []);
  const { rot, dragging, handlers } = useTilt(REST, { disabled: reduced || !has3D });
  const { ref, fit } = useFit();

  const a = analytics;
  const shares = a?.churned_share_by_contract ?? [];
  const share = (g: string) => shares.find((s) => s.group === g)?.share ?? 0;
  const drivers = (a?.global_importance ?? []).slice(0, 4);
  const maxDriver = drivers[0]?.mean_abs_shap ?? 1;
  const topCustomer = a?.top_risk_customers?.[0];

  const label = a
    ? `Illustration of the Retentra dashboard: churn rate ${pct(a.totals.churn_rate, 1)} across ${num(a.totals.customers)} customers.`
    : "Illustration of the Retentra analytics dashboard.";

  return (
    <div className="hero-fit" ref={ref} style={{ ["--fit" as string]: fit }}>
    <div
      className={`hero-stage ${has3D ? "" : "flat"} ${reduced ? "still" : ""} ${dragging ? "dragging" : ""}`}
      role="img"
      aria-label={label}
      {...handlers}
    >
      <div
        className="hero-scene"
        style={{
          transform: `rotateX(${rot.x}deg) rotateY(${rot.y}deg)`,
          transition: dragging ? "transform 0.05s linear" : "transform 0.9s var(--ease-spring)",
        }}
      >
        <div className="hs-floor">
          <Podium size={400} />
        </div>

        <div className="hs-item hs-screen" style={{ ["--d" as string]: "0.1s" }}>
          <div className="bob">
            <div className="navy hs-screen-card">
              <div className="hs-row">
                <span className="hs-title">Churn Overview</span>
                <span className="hs-chip">IBM Telco data</span>
              </div>
              <div className="hs-panel">
                <div className="hs-kpi">
                  <span className="muted">Churn rate</span>
                  <strong>{a ? pct(a.totals.churn_rate, 1) : "—"}</strong>
                  <span className="hs-sub">of {a ? num(a.totals.customers) : "—"} customers</span>
                </div>
                <div className="hs-chart">{a && <TenureArea rows={a.churn_by_tenure_band} />}</div>
              </div>
              <div className="hs-tiles">
                <span>
                  <em>Customers</em>
                  {a ? num(a.totals.customers) : "—"}
                </span>
                <span className="warm">
                  <em>Churned</em>
                  {a ? num(a.totals.churned) : "—"}
                </span>
                <span>
                  <em>Retained</em>
                  {a ? pct(a.totals.retention_rate, 1) : "—"}
                </span>
                <span>
                  <em>Avg tenure</em>
                  {a ? `${Math.round(a.totals.avg_tenure_months)} mo` : "—"}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="hs-item hs-left-top" style={{ ["--d" as string]: "0.35s" }}>
          <div className="bob slow">
            <div className="glass hs-card">
              <span className="hs-card-title">Churned customers by contract</span>
              <div className="hs-donut">
                <Donut
                  size={74}
                  label="Share of churned customers by contract"
                  segments={[
                    { name: "Month-to-month", value: share("Month-to-month"), color: "#F2803A" },
                    { name: "One year", value: share("One year"), color: "#4A63F0" },
                    { name: "Two year", value: share("Two year"), color: "#1E2A5E" },
                  ]}
                />
                <ul>
                  <li>
                    <i style={{ background: "#F2803A" }} />
                    Monthly {pct(share("Month-to-month"))}
                  </li>
                  <li>
                    <i style={{ background: "#4A63F0" }} />1 year {pct(share("One year"))}
                  </li>
                  <li>
                    <i style={{ background: "#1E2A5E" }} />2 year {pct(share("Two year"))}
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <div className="hs-item hs-left-bottom" style={{ ["--d" as string]: "0.5s" }}>
          <div className="bob">
            <div className="glass hs-card">
              <span className="hs-card-title">Model ROC-AUC</span>
              <strong className="hs-big">{a ? a.test_metrics.roc_auc.toFixed(3) : "—"}</strong>
              <span className="hs-sub dark">on {a ? num(a.test_set.customers) : "—"} held-out customers</span>
            </div>
          </div>
        </div>

        <div className="hs-item hs-right-top" style={{ ["--d" as string]: "0.45s" }}>
          <div className="bob slow">
            <div className="glass hs-card">
              <span className="hs-card-title">Top churn drivers (SHAP)</span>
              <ul className="hs-drivers">
                {drivers.map((d, i) => (
                  <li key={d.feature}>
                    <span>{d.label}</span>
                    <span className="meter">
                      <span style={{ width: `${(d.mean_abs_shap / maxDriver) * 100}%`, background: i === 0 ? "var(--risk-high)" : undefined }} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="hs-item hs-right-bottom" style={{ ["--d" as string]: "0.6s" }}>
          <div className="bob">
            <div className="navy hs-card">
              <span className="muted hs-small">Highest risk · #{topCustomer?.customer_id ?? "—"}</span>
              <div className="hs-row">
                <strong className="hs-big light">{topCustomer ? pct(topCustomer.probability) : "—"}</strong>
                <span className="badge badge-High">High risk</span>
              </div>
              <span className="meter">
                <span style={{ width: `${(topCustomer?.probability ?? 0) * 100}%`, background: "linear-gradient(90deg,#FFB37E,#F2803A)" }} />
              </span>
            </div>
          </div>
        </div>

        <div className="hs-item hs-pie" style={{ ["--d" as string]: "0.75s" }}>
          <div className="bob slow">
            {/* Decorative 3D pie: churned share by contract when data is loaded, equal slices otherwise. */}
            <Pie3D
              size={130}
              slices={[
                { share: a ? share("Month-to-month") : 1 / 3, color: "#6C83FF", dark: "#2F44C4" },
                { share: a ? share("One year") : 1 / 3, color: "#A9B8FF", dark: "#5266D6" },
                { share: a ? share("Two year") : 1 / 3, color: "#3A51D6", dark: "#1E2A8A" },
              ]}
            />
          </div>
        </div>

        <div className="hs-item hs-icon hs-icon-a" style={{ ["--d" as string]: "0.85s" }}>
          <div className="bob">
            <span className="glass icon-tile">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2C3FA8" strokeWidth="2.4" strokeLinecap="round">
                <path d="M5 19V13M12 19V8M19 19V4" />
              </svg>
            </span>
          </div>
        </div>
        <div className="hs-item hs-icon hs-icon-b" style={{ ["--d" as string]: "0.95s" }}>
          <div className="bob slow">
            <span className="glass icon-tile">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2C3FA8" strokeWidth="2.2" strokeLinecap="round">
                <circle cx="9" cy="8" r="4" />
                <path d="M2 21c1-4 4-6 7-6s6 2 7 6M17 8h5" />
              </svg>
            </span>
          </div>
        </div>
      </div>
      {has3D && !reduced && <span className="hero-hint">Drag to rotate</span>}
    </div>
    </div>
  );
}
