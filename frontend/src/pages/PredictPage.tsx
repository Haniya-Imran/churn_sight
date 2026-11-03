import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { History, Info, Trash2, Users } from "lucide-react";
import { ApiError, api } from "../lib/api";
import { DEFAULT_VALUES, applyDependencies, fromCustomer, toPayload, validate, type FormErrors, type FormValues } from "../lib/form";
import { pct } from "../lib/format";
import { addEntry, clearHistoryStorage, loadHistory, saveHistory, type HistoryEntry } from "../lib/history";
import { buildReportHtml, downloadFile, reportFileName } from "../lib/report";
import type { CustomerInput, FeatureKey, PredictResponse } from "../lib/types";
import { useApi } from "../lib/useApi";
import { CustomerForm } from "../components/CustomerForm";
import { ExplanationPanel, Recommendations, ResultActions, WhyCard } from "../components/Results";
import { ErrorState, LoadingBlock } from "../components/States";
import { RiskOrb } from "../components/three/RiskOrb";

type Current = { response: PredictResponse; input: CustomerInput; label: string; values: FormValues };
type IncomingState = { customer?: CustomerInput; label?: string } | null;

export function PredictPage() {
  const info = useApi(api.modelInfo);
  const samples = useApi(api.samples);
  const location = useLocation();
  const navigate = useNavigate();

  const [values, setValues] = useState<FormValues>(DEFAULT_VALUES);
  const [errors, setErrors] = useState<FormErrors>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [current, setCurrent] = useState<Current | null>(null);
  const [label, setLabel] = useState("Custom customer");
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());
  const reqId = useRef(0);
  const inflight = useRef<AbortController | null>(null);
  const handledIncoming = useRef(false);

  const specs = info.data?.features;
  const stale = useMemo(() => !!current && JSON.stringify(current.values) !== JSON.stringify(values), [current, values]);

  useEffect(() => () => inflight.current?.abort(), []);

  const run = useCallback(
    async (vals: FormValues, runLabel: string) => {
      if (!specs || loading) return;
      const errs = validate(vals, specs);
      setErrors(errs);
      if (Object.keys(errs).length) {
        const first = Object.keys(errs)[0];
        requestAnimationFrame(() => document.getElementById(`f-${first}`)?.focus());
        return;
      }
      const input = toPayload(vals);
      const id = ++reqId.current;
      inflight.current?.abort();
      const controller = new AbortController();
      inflight.current = controller;
      setLoading(true);
      setError(null);
      try {
        const response = await api.predict(input, controller.signal);
        if (id !== reqId.current) return; // a newer request superseded this one
        setCurrent({ response, input, label: runLabel, values: vals });
        setHistory((h) => {
          const next = addEntry(h, {
            id: `${Date.now()}-${id}`,
            at: response.generated_at,
            label: runLabel,
            input,
            probability: response.prediction.probability,
            band: response.prediction.risk_band,
          });
          saveHistory(next);
          return next;
        });
        requestAnimationFrame(() => document.getElementById("result-start")?.focus({ preventScroll: true }));
      } catch (e) {
        if (id !== reqId.current) return;
        const err = e instanceof ApiError ? e : new ApiError("server", "Unexpected error.");
        if (err.kind === "aborted") return;
        if (err.kind === "validation" && err.details) {
          const fieldErrs: FormErrors = {};
          for (const d of err.details) if (d.field) fieldErrs[d.field as FeatureKey] = d.message;
          setErrors(fieldErrs);
        }
        setError(err);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    },
    [specs, loading],
  );

  // A customer sent from the dashboard ("Analyse") is filled in and predicted once.
  useEffect(() => {
    const incoming = location.state as IncomingState;
    if (!specs || handledIncoming.current || !incoming?.customer) return;
    handledIncoming.current = true;
    const vals = fromCustomer(incoming.customer);
    const l = incoming.label ?? "Customer";
    setValues(vals);
    setLabel(l);
    navigate(location.pathname, { replace: true, state: null });
    void run(vals, l);
  }, [specs, location, navigate, run]);

  const onChange = (field: FeatureKey, value: string) => {
    setValues((v) => applyDependencies({ ...v, [field]: value }, field));
    setErrors((e) => {
      if (!e[field]) return e;
      const next = { ...e };
      delete next[field];
      return next;
    });
    if (label !== "Custom customer") setLabel("Custom customer");
  };

  const reset = () => {
    reqId.current++;
    inflight.current?.abort();
    setLoading(false);
    setValues(DEFAULT_VALUES);
    setErrors({});
    setError(null);
    setCurrent(null);
    setLabel("Custom customer");
    requestAnimationFrame(() => document.getElementById("f-tenure")?.focus());
  };

  const loadCustomer = (c: CustomerInput, l: string) => {
    const vals = fromCustomer(c);
    setValues(vals);
    setLabel(l);
    void run(vals, l);
  };

  const featureLabels = useMemo(() => {
    const out: Record<string, string> = {};
    if (specs) for (const [k, s] of Object.entries({ ...specs.numeric, ...specs.categorical })) out[k] = s.label;
    return out;
  }, [specs]);

  if (info.loading) {
    return (
      <div className="container page">
        <PageTitle />
        <LoadingBlock label="Loading the model's input fields" height={420} />
      </div>
    );
  }
  if (info.error || !specs) {
    return (
      <div className="container page">
        <PageTitle />
        <ErrorState title="The prediction service isn't available" error={info.error ?? new Error("Model details missing.")} onRetry={info.retry} />
      </div>
    );
  }

  const result = current?.response ?? null;
  const p = result?.prediction;

  return (
    <div className="container page">
      <PageTitle modelChip={`${info.data!.model_name} · ROC-AUC ${info.data!.test_metrics.roc_auc.toFixed(3)}`} />

      <section className="demo-bar glass" aria-labelledby="demo-title">
        <span id="demo-title" className="demo-title">
          <Users size={16} aria-hidden="true" /> Demo customers
        </span>
        {samples.data ? (
          <>
            {samples.data.samples.map((s) => (
              <button key={s.customer_id} type="button" className="btn btn-glass btn-sm" disabled={loading} onClick={() => loadCustomer(s.features, `Demo · ${s.label} (#${s.customer_id})`)}>
                {s.label}
              </button>
            ))}
            <span className="demo-note">Demonstration data: real customers from the dataset's held-out test set.</span>
          </>
        ) : samples.error ? (
          <span className="demo-note">Demo customers could not be loaded.</span>
        ) : (
          <span className="demo-note">Loading…</span>
        )}
      </section>

      <div className="predict-grid">
        <CustomerForm specs={specs} values={values} errors={errors} loading={loading} onChange={onChange} onSubmit={() => run(values, label)} onReset={reset} />

        <div className="predict-results">
          <div id="result-start" tabIndex={-1} className="sr-only">
            {result && p ? `Prediction ready: ${pct(p.probability)} churn probability, ${p.risk_band} risk.` : ""}
          </div>
          {error && (
            <ErrorState
              title={error.kind === "validation" ? "Please check the customer details" : "Prediction failed"}
              error={error}
              onRetry={error.kind === "validation" ? undefined : () => run(values, label)}
            />
          )}
          {stale && !loading && (
            <div className="alert alert-info" role="status">
              <Info size={18} aria-hidden="true" /> The inputs changed since this result. Press <strong>Predict churn</strong> to update it.
            </div>
          )}

          <div className={`result-top ${stale ? "is-stale" : ""}`}>
            <RiskOrb
              probability={p ? p.probability : null}
              band={p ? p.risk_band : null}
              loading={loading}
              caption={current ? current.label : "No prediction yet"}
              subcaption={p ? `${p.label} · threshold ${pct(p.threshold, 1)}` : "Fill in the form or try a demo customer"}
            />
            <WhyCard result={result} stale={stale} />
          </div>

          {result && current && (
            <div className={`result-detail ${stale ? "is-stale" : ""}`}>
              <ResultActions
                onReport={() => downloadFile(reportFileName(current.label, "html"), buildReportHtml(current.label, current.input, result, featureLabels), "text/html")}
                onJson={() =>
                  downloadFile(reportFileName(current.label, "json"), JSON.stringify({ customer: current.label, input: current.input, ...result }, null, 2), "application/json")
                }
                onNew={reset}
              />
              <ExplanationPanel result={result} />
              <Recommendations result={result} />
            </div>
          )}

          <section className="glass panel" aria-labelledby="hist-title">
            <div className="panel-head">
              <div>
                <h2 id="hist-title" className="card-title">
                  <History size={17} aria-hidden="true" /> This session's predictions
                </h2>
                <p className="muted">Kept only in this browser tab and cleared when you close it.</p>
              </div>
              {history.length > 0 && (
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  onClick={() => {
                    clearHistoryStorage();
                    setHistory([]);
                  }}
                >
                  <Trash2 size={15} aria-hidden="true" /> Clear
                </button>
              )}
            </div>
            {history.length === 0 ? (
              <p className="empty">No predictions yet.</p>
            ) : (
              <ul className="history">
                {history.map((h) => (
                  <li key={h.id}>
                    <span className={`badge badge-${h.band}`}>{pct(h.probability)}</span>
                    <span className="history-label">
                      {h.label}
                      <span className="muted">{new Date(h.at).toLocaleTimeString()}</span>
                    </span>
                    <button type="button" className="btn btn-glass btn-sm" disabled={loading} onClick={() => loadCustomer(h.input, h.label)}>
                      Re-run
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="limits muted">
            <strong>Limitations:</strong> estimates come from historical patterns in IBM's fictional Telco sample data. The model doesn't see
            complaints, usage or competitor offers, and SHAP explains the model, not proven causes.{" "}
            <Link to="/model">Model details</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

function PageTitle({ modelChip }: { modelChip?: string }) {
  return (
    <div className="page-title">
      <div>
        <h1>Predict a Customer</h1>
        <p className="muted">Enter a customer's details to see how likely they are to leave, why, and what to do about it.</p>
      </div>
      {modelChip && <span className="chip">{modelChip}</span>}
    </div>
  );
}
