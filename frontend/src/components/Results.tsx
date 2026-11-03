import { ArrowDownRight, ArrowUpRight, Download, FileJson, Lightbulb, ShieldCheck } from "lucide-react";
import { formatValue, pct, signed, strengthLabel } from "../lib/format";
import type { Contribution, PredictResponse } from "../lib/types";
import { ShapWaterfall } from "./charts";
import { Tooltip } from "./Tooltip";

export function WhyCard({ result, stale }: { result: PredictResponse | null; stale: boolean }) {
  if (!result) {
    return (
      <section className="navy why-card tilt-right" aria-labelledby="why-title">
        <h2 id="why-title" className="card-title">
          Why this score?
        </h2>
        <p className="muted">
          After a prediction, the factors that pushed this customer's risk up or down appear here, measured with SHAP.
        </p>
        <ul className="why-placeholder" aria-hidden="true">
          {[80, 55, 35, 20].map((w) => (
            <li key={w}>
              <span className="meter">
                <span style={{ width: `${w}%`, opacity: 0.25 }} />
              </span>
            </li>
          ))}
        </ul>
      </section>
    );
  }
  const up = result.explanation.top_increasing.slice(0, 4);
  const down = result.explanation.top_decreasing.slice(0, 2);
  const max = Math.max(...[...up, ...down].map((c) => Math.abs(c.impact_pct_points)), 1);
  const first = result.recommendations[1] ?? result.recommendations[0];
  return (
    <section className={`navy why-card tilt-right ${stale ? "is-stale" : ""}`} aria-labelledby="why-title">
      <div className="why-head">
        <h2 id="why-title" className="card-title">
          Why this score?
        </h2>
        <Tooltip
          text="Each bar shows roughly how many percentage points a factor adds to (+) or removes from (−) this customer's churn probability, based on SHAP values."
          label="How to read these bars"
        />
      </div>
      <FactorList items={up} max={max} kind="up" title="Raising the risk" />
      {down.length > 0 && <FactorList items={down} max={max} kind="down" title="Lowering the risk" />}
      {first && (
        <div className="why-action">
          <span className="muted">Suggested first action</span>
          <strong>{first.title}</strong>
        </div>
      )}
    </section>
  );
}

function FactorList({ items, max, kind, title }: { items: Contribution[]; max: number; kind: "up" | "down"; title: string }) {
  return (
    <div className="factor-list">
      <h3 className="factor-title">
        {kind === "up" ? <ArrowUpRight size={15} aria-hidden="true" /> : <ArrowDownRight size={15} aria-hidden="true" />} {title}
      </h3>
      <ul>
        {items.map((c) => (
          <li key={c.feature}>
            <div className="factor-head">
              <span>
                {c.label}: <strong>{formatValue(c.feature, c.value)}</strong>
              </span>
              <span className={`factor-num ${kind}`}>{signed(c.impact_pct_points)} pts</span>
            </div>
            <span className="meter">
              <span className={kind === "up" ? "bar-up" : "bar-down"} style={{ width: `${(Math.abs(c.impact_pct_points) / max) * 100}%` }} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ExplanationPanel({ result }: { result: PredictResponse }) {
  const e = result.explanation;
  return (
    <section className="glass panel" aria-labelledby="shap-title">
      <div className="panel-head">
        <div>
          <h2 id="shap-title" className="card-title">
            SHAP explanation
          </h2>
          <p className="muted">How each input moved the model from a typical customer to this customer.</p>
        </div>
        <Tooltip text={e.note} label="What SHAP means" />
      </div>
      <p className="summary">{e.summary}</p>
      <ShapWaterfall
        contributions={e.contributions}
        baseValue={e.base_value}
        output={e.model_output}
        baseProbability={e.base_probability}
        probability={result.prediction.probability}
      />
      <p className="note">
        <ShieldCheck size={15} aria-hidden="true" /> {e.note}
      </p>
      <details className="advanced">
        <summary>Advanced details</summary>
        <dl className="adv-grid">
          <dt>Explainer</dt>
          <dd>{e.method}</dd>
          <dt>Output space</dt>
          <dd>{e.output_space}</dd>
          <dt>Base value</dt>
          <dd>
            {e.base_value.toFixed(4)} ({pct(e.base_probability, 1)})
          </dd>
          <dt>Model output</dt>
          <dd>
            {e.model_output.toFixed(4)} ({pct(result.prediction.probability, 1)})
          </dd>
          <dt>Decision threshold</dt>
          <dd>{pct(result.prediction.threshold, 1)} — at or above this the model predicts churn</dd>
          <dt>High-risk cut-off</dt>
          <dd>{pct(result.prediction.high_risk_cutoff)}</dd>
          <dt>Model</dt>
          <dd>
            {result.model.name} v{result.model.version}
          </dd>
        </dl>
        <div className="table-scroll">
          <table className="data-table compact">
            <caption className="sr-only">All SHAP contributions for this customer</caption>
            <thead>
              <tr>
                <th scope="col">Factor</th>
                <th scope="col">Value</th>
                <th scope="col">SHAP (log-odds)</th>
                <th scope="col">≈ Probability points</th>
                <th scope="col">Strength</th>
              </tr>
            </thead>
            <tbody>
              {e.contributions.map((c) => (
                <tr key={c.feature}>
                  <td>{c.label}</td>
                  <td>{formatValue(c.feature, c.value)}</td>
                  <td className={c.shap_value > 0 ? "up" : "down"}>{signed(c.shap_value, 4)}</td>
                  <td>{signed(c.impact_pct_points)}</td>
                  <td>{strengthLabel(c.impact_pct_points)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

export function Recommendations({ result }: { result: PredictResponse }) {
  return (
    <section className="glass panel" aria-labelledby="rec-title">
      <div className="panel-head">
        <div>
          <h2 id="rec-title" className="card-title">
            Retention suggestions
          </h2>
          <p className="muted">Based on this customer's inputs, the prediction and its SHAP drivers. Not guaranteed to prevent churn.</p>
        </div>
        <Lightbulb size={20} aria-hidden="true" />
      </div>
      <ol className="recs">
        {result.recommendations.map((r) => (
          <li key={r.id} className="rec">
            <div className="rec-head">
              <span className={`badge badge-${r.priority}`}>{r.priority} priority</span>
              <h3>{r.title}</h3>
            </div>
            <p className="rec-action">{r.action}</p>
            <p className="rec-why">
              <strong>Why:</strong> {r.why}
            </p>
            <div className="rec-cols">
              <div>
                <span className="rec-label">Evidence</span>
                <ul>
                  {r.evidence.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
              <div>
                <span className="rec-label">Assumption</span>
                <p>{r.assumption}</p>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function ResultActions({ onReport, onJson, onNew }: { onReport: () => void; onJson: () => void; onNew: () => void }) {
  return (
    <div className="result-actions no-print">
      <button type="button" className="btn btn-glass" onClick={onReport}>
        <Download size={16} aria-hidden="true" /> Download report
      </button>
      <button type="button" className="btn btn-glass" onClick={onJson}>
        <FileJson size={16} aria-hidden="true" /> Export JSON
      </button>
      <button type="button" className="btn btn-quiet" onClick={onNew}>
        New prediction
      </button>
    </div>
  );
}
