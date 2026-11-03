import { api } from "../lib/api";
import { num, pct } from "../lib/format";
import { useApi } from "../lib/useApi";
import { RateBars } from "../components/charts";
import { ErrorState, LoadingBlock } from "../components/States";
import { Tooltip } from "../components/Tooltip";

export function ModelPage() {
  const { data: m, error, loading, retry } = useApi(api.modelInfo);

  return (
    <div className="container page">
      <div className="page-title">
        <div>
          <h1>Model & Limitations</h1>
          <p className="muted">How the model was built, how well it performs on unseen customers, and where it falls short.</p>
        </div>
        {m && (
          <span className="chip">
            {m.model_name} v{m.model_version}
          </span>
        )}
      </div>
      {loading && <LoadingBlock label="Loading model details" height={400} />}
      {error && <ErrorState title="Model details aren't available" error={error} onRetry={retry} />}
      {m && (
        <>
          <section className="metric-grid" aria-label="Test-set metrics">
            {(
              [
                ["ROC-AUC", m.test_metrics.roc_auc.toFixed(3), "How well the model ranks churners above non-churners (0.5 = random, 1 = perfect)."],
                ["PR-AUC", m.test_metrics.pr_auc.toFixed(3), `Precision–recall area. A model that guesses scores about ${m.dataset.churn_rate.toFixed(2)}.`],
                ["Recall", pct(m.test_metrics.recall, 1), "Share of customers who actually left that the model flagged."],
                ["Precision", pct(m.test_metrics.precision, 1), "Share of flagged customers who actually left."],
                ["F1 score", m.test_metrics.f1.toFixed(3), "Balance of precision and recall."],
                ["Accuracy", pct(m.test_metrics.accuracy, 1), "Share of all predictions that were right."],
              ] as const
            ).map(([k, v, t]) => (
              <div key={k} className="glass metric">
                <span className="metric-label">
                  {k} <Tooltip text={t} label={`About ${k}`} />
                </span>
                <strong>{v}</strong>
              </div>
            ))}
          </section>
          <p className="tiny muted">
            Measured on {num(m.split.test_rows)} held-out customers ({pct(m.split.test_size)} stratified split, seed {m.split.random_state}) at the
            decision threshold of {pct(m.threshold.value, 1)}. Trained {new Date(m.trained_at).toLocaleDateString()}.
          </p>

          <div className="dash-row">
            <section className="glass panel" aria-labelledby="cm-title">
              <h2 id="cm-title" className="card-title">
                Confusion matrix
              </h2>
              <div className="cm">
                <span />
                <span className="cm-h">Predicted stay</span>
                <span className="cm-h">Predicted churn</span>
                <span className="cm-h side">Actually stayed</span>
                <span className="cm-cell good">{m.test_metrics.confusion_matrix.tn}</span>
                <span className="cm-cell bad">{m.test_metrics.confusion_matrix.fp}</span>
                <span className="cm-h side">Actually churned</span>
                <span className="cm-cell bad">{m.test_metrics.confusion_matrix.fn}</span>
                <span className="cm-cell good">{m.test_metrics.confusion_matrix.tp}</span>
              </div>
              <dl className="explain-list">
                <dt>False positives ({m.error_analysis.false_positives})</dt>
                <dd>{m.error_analysis.false_positive_meaning}</dd>
                <dt>False negatives ({m.error_analysis.false_negatives})</dt>
                <dd>{m.error_analysis.false_negative_meaning}</dd>
              </dl>
            </section>

            <section className="glass panel" aria-labelledby="imp-title">
              <h2 id="imp-title" className="card-title">
                What the model relies on most
              </h2>
              <p className="muted">Mean absolute SHAP value on held-out customers, relative to the largest.</p>
              <RateBars
                rows={m.global_importance.map((g) => ({ label: g.label, value: g.mean_abs_shap / m.global_importance[0].mean_abs_shap }))}
                max={1}
                highlight={(_, v) => v === 1}
              />
            </section>
          </div>

          <section className="glass panel" aria-labelledby="cmp-title">
            <h2 id="cmp-title" className="card-title">
              Model comparison (5-fold cross-validation on the training split)
            </h2>
            <p className="muted">{m.selection_rule}</p>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Model</th>
                    <th scope="col">ROC-AUC</th>
                    <th scope="col">PR-AUC</th>
                    <th scope="col">F1</th>
                    <th scope="col">Recall</th>
                    <th scope="col">Precision</th>
                    <th scope="col">Brier</th>
                  </tr>
                </thead>
                <tbody>
                  {m.comparison.map((c) => (
                    <tr key={c.model} className={c.model === m.model_name ? "selected-row" : undefined}>
                      <th scope="row">
                        {c.model}
                        {c.model === m.model_name && <span className="badge badge-Low inline">Selected</span>}
                      </th>
                      <td>{c.cv_out_of_fold.roc_auc.toFixed(3)}</td>
                      <td>{c.cv_out_of_fold.pr_auc.toFixed(3)}</td>
                      <td>{c.cv_out_of_fold.f1.toFixed(3)}</td>
                      <td>{pct(c.cv_out_of_fold.recall, 1)}</td>
                      <td>{pct(c.cv_out_of_fold.precision, 1)}</td>
                      <td>{c.cv_out_of_fold.brier.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="dash-row">
            <section className="glass panel" aria-labelledby="thr-title">
              <h2 id="thr-title" className="card-title">
                Threshold, risk bands & reliability
              </h2>
              <dl className="explain-list">
                <dt>Decision threshold: {pct(m.threshold.value, 1)}</dt>
                <dd>{m.threshold.method}</dd>
                <dt>Risk bands</dt>
                <dd>
                  Low: {m.risk_bands.Low}. Medium: {m.risk_bands.Medium}. High: {m.risk_bands.High}.
                </dd>
                <dt>Class imbalance</dt>
                <dd>
                  {pct(m.class_imbalance.train_churn_rate, 1)} of training customers churned. {m.class_imbalance.strategy}
                </dd>
                <dt>Overfitting check</dt>
                <dd>
                  Train ROC-AUC {m.overfitting_check.train_roc_auc.toFixed(3)} vs test {m.overfitting_check.test_roc_auc.toFixed(3)} (gap{" "}
                  {m.overfitting_check.gap.toFixed(3)}): {m.overfitting_check.verdict}.
                </dd>
                <dt>Versus a baseline</dt>
                <dd>
                  A model that always predicts the average churn rate scores ROC-AUC {m.baseline_test_metrics.roc_auc.toFixed(2)} and finds no
                  churners.
                </dd>
              </dl>
            </section>
            <section className="glass panel" aria-labelledby="data-title">
              <h2 id="data-title" className="card-title">
                Data & explanations
              </h2>
              <dl className="explain-list">
                <dt>Dataset</dt>
                <dd>
                  <a href={m.dataset.repository} target="_blank" rel="noreferrer">
                    {m.dataset.name}
                  </a>{" "}
                  — {num(m.dataset.rows)} customers, {pct(m.dataset.churn_rate, 1)} churned. {m.dataset.description} License: {m.dataset.license}.
                </dd>
                <dt>SHAP method</dt>
                <dd>
                  {m.shap.method}, {m.shap.background_rows} background customers, explained in {m.shap.output_space}. {m.shap.note}
                </dd>
              </dl>
              <h3 className="card-title small">Limitations</h3>
              <ul className="limit-list">
                {m.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
