import { Calculator, RotateCcw, Sparkles } from "lucide-react";
import type { FormEvent } from "react";
import { FIELD_GROUPS, estimateTotal, isLocked, optionsFor, type FeatureSpecs, type FormErrors, type FormValues } from "../lib/form";
import type { FeatureKey } from "../lib/types";
import { Tooltip } from "./Tooltip";

type Props = {
  specs: FeatureSpecs;
  values: FormValues;
  errors: FormErrors;
  loading: boolean;
  onChange: (field: FeatureKey, value: string) => void;
  onSubmit: () => void;
  onReset: () => void;
};

export function CustomerForm({ specs, values, errors, loading, onChange, onSubmit, onReset }: Props) {
  const errorCount = Object.keys(errors).length;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  const estimate = estimateTotal(values);

  return (
    <form className="glass form-card tilt-left" onSubmit={submit} noValidate aria-describedby="form-intro">
      <div className="form-head">
        <h2 className="card-title">Customer details</h2>
        <p id="form-intro" className="field-help">
          Fields marked with a unit need a number. Choices start at the most common answer in the dataset.
        </p>
      </div>

      {errorCount > 0 && (
        <div className="alert alert-error" role="alert">
          <span>
            Please fix {errorCount} {errorCount === 1 ? "field" : "fields"} highlighted below.
          </span>
        </div>
      )}

      {FIELD_GROUPS.map((group) => (
        <fieldset key={group.title} className="form-group">
          <legend>
            {group.title}
            <span className="legend-sub">{group.description}</span>
          </legend>
          <div className="form-grid">
            {group.fields.map((field) => {
              const num = specs.numeric[field];
              const cat = specs.categorical[field];
              const id = `f-${field}`;
              const err = errors[field];
              const describedBy = [`${id}-help`, err ? `${id}-err` : ""].filter(Boolean).join(" ");
              if (num) {
                return (
                  <div className="field" key={field}>
                    <div className="field-label">
                      <label htmlFor={id}>
                        {num.label} <span className="field-unit">({num.unit})</span>
                      </label>
                      <Tooltip text={num.help} label={`About ${num.label}`} />
                    </div>
                    <input
                      id={id}
                      name={field}
                      className="input"
                      type="number"
                      inputMode={num.integer ? "numeric" : "decimal"}
                      min={num.min}
                      max={num.max}
                      step={num.step}
                      value={values[field]}
                      onChange={(e) => onChange(field, e.target.value)}
                      aria-invalid={err ? true : undefined}
                      aria-describedby={describedBy}
                      placeholder={field === "tenure" ? "e.g. 12" : "e.g. 70.35"}
                    />
                    <span id={`${id}-help`} className="field-help">
                      {field === "TotalCharges" && estimate !== null ? (
                        <button type="button" className="link-btn" onClick={() => onChange("TotalCharges", estimate)}>
                          <Calculator size={13} aria-hidden="true" /> Use estimate ${Number(estimate).toLocaleString("en-US")}
                        </button>
                      ) : (
                        `${num.min}–${num.max.toLocaleString("en-US")}`
                      )}
                    </span>
                    {err && (
                      <span id={`${id}-err`} className="field-error">
                        {err}
                      </span>
                    )}
                  </div>
                );
              }
              const locked = isLocked(field, values);
              const opts = optionsFor(field, values, cat);
              const catDescribedBy = [locked ? `${id}-help` : "", err ? `${id}-err` : ""].filter(Boolean).join(" ") || undefined;
              return (
                <div className="field" key={field}>
                  <div className="field-label">
                    <label htmlFor={id}>{cat.label}</label>
                    <Tooltip text={cat.help} label={`About ${cat.label}`} />
                  </div>
                  <select
                    id={id}
                    name={field}
                    className="select"
                    value={values[field]}
                    disabled={locked}
                    onChange={(e) => onChange(field, e.target.value)}
                    aria-invalid={err ? true : undefined}
                    aria-describedby={catDescribedBy}
                  >
                    {opts.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                  {locked && (
                    <span id={`${id}-help`} className="field-help">
                      {field === "MultipleLines" ? "Set by Phone service" : "Set by Internet service"}
                    </span>
                  )}
                  {err && (
                    <span id={`${id}-err`} className="field-error">
                      {err}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}

      <div className="form-actions">
        <button type="submit" className="btn btn-primary btn-wide" disabled={loading} aria-busy={loading}>
          {loading ? (
            <>
              <span className="spinner" aria-hidden="true" /> Predicting…
            </>
          ) : (
            <>
              <Sparkles size={17} aria-hidden="true" /> Predict churn
            </>
          )}
        </button>
        <button type="button" className="btn btn-glass" onClick={onReset} disabled={loading}>
          <RotateCcw size={16} aria-hidden="true" /> Reset
        </button>
      </div>
    </form>
  );
}
