import type { CategoricalSpec, CustomerInput, FeatureKey, NumericSpec } from "./types";

export type FormValues = Record<FeatureKey, string>;
export type FormErrors = Partial<Record<FeatureKey, string>>;
export type FeatureSpecs = { numeric: Record<string, NumericSpec>; categorical: Record<string, CategoricalSpec> };

/** Visual grouping of the model's inputs. Keys must match the backend schema exactly. */
export const FIELD_GROUPS: { title: string; description: string; fields: FeatureKey[] }[] = [
  {
    title: "Account & billing",
    description: "Contract, tenure and what the customer pays.",
    fields: ["tenure", "Contract", "MonthlyCharges", "TotalCharges", "PaymentMethod", "PaperlessBilling"],
  },
  {
    title: "Services",
    description: "Phone, internet and add-on subscriptions.",
    fields: [
      "PhoneService",
      "MultipleLines",
      "InternetService",
      "OnlineSecurity",
      "OnlineBackup",
      "DeviceProtection",
      "TechSupport",
      "StreamingTV",
      "StreamingMovies",
    ],
  },
  {
    title: "Household",
    description: "Basic customer profile.",
    fields: ["SeniorCitizen", "Partner", "Dependents"],
  },
];

export const ALL_FIELDS: FeatureKey[] = FIELD_GROUPS.flatMap((g) => g.fields);

export const INTERNET_ADDONS: FeatureKey[] = [
  "OnlineSecurity",
  "OnlineBackup",
  "DeviceProtection",
  "TechSupport",
  "StreamingTV",
  "StreamingMovies",
];

/**
 * Starting values. Categorical fields use the most common answer in the
 * IBM Telco dataset; numeric fields start empty so the user must enter them.
 */
export const DEFAULT_VALUES: FormValues = {
  tenure: "",
  Contract: "Month-to-month",
  MonthlyCharges: "",
  TotalCharges: "",
  PaymentMethod: "Electronic check",
  PaperlessBilling: "Yes",
  PhoneService: "Yes",
  MultipleLines: "No",
  InternetService: "Fiber optic",
  OnlineSecurity: "No",
  OnlineBackup: "No",
  DeviceProtection: "No",
  TechSupport: "No",
  StreamingTV: "No",
  StreamingMovies: "No",
  SeniorCitizen: "No",
  Partner: "No",
  Dependents: "No",
};

/** Keep dependent fields consistent with the dataset's recording rules. */
export function applyDependencies(values: FormValues, changed?: FeatureKey): FormValues {
  const next = { ...values };
  if (next.InternetService === "No") {
    for (const f of INTERNET_ADDONS) next[f] = "No internet service";
  } else if (changed === "InternetService") {
    for (const f of INTERNET_ADDONS) if (next[f] === "No internet service") next[f] = "No";
  }
  if (next.PhoneService === "No") next.MultipleLines = "No phone service";
  else if (next.MultipleLines === "No phone service") next.MultipleLines = "No";
  if (changed === "tenure" && next.tenure.trim() === "0") next.TotalCharges = "0";
  return next;
}

export function isLocked(field: FeatureKey, values: FormValues): boolean {
  if (INTERNET_ADDONS.includes(field)) return values.InternetService === "No";
  if (field === "MultipleLines") return values.PhoneService === "No";
  return false;
}

/** Options a field may show given the current values (mirrors backend rules). */
export function optionsFor(field: FeatureKey, values: FormValues, spec: CategoricalSpec): string[] {
  if (INTERNET_ADDONS.includes(field)) {
    return values.InternetService === "No" ? ["No internet service"] : spec.options.filter((o) => o !== "No internet service");
  }
  if (field === "MultipleLines") {
    return values.PhoneService === "No" ? ["No phone service"] : spec.options.filter((o) => o !== "No phone service");
  }
  return spec.options;
}

export function validate(values: FormValues, specs: FeatureSpecs): FormErrors {
  const errors: FormErrors = {};
  for (const [key, spec] of Object.entries(specs.numeric)) {
    const k = key as FeatureKey;
    const raw = values[k].trim();
    if (raw === "") {
      errors[k] = `Enter ${spec.label.toLowerCase()}.`;
      continue;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) errors[k] = "Enter a number.";
    else if (spec.integer && !Number.isInteger(n)) errors[k] = "Use whole months.";
    else if (n < spec.min || n > spec.max) errors[k] = `Must be between ${spec.min} and ${spec.max.toLocaleString()}.`;
  }
  for (const [key, spec] of Object.entries(specs.categorical)) {
    const k = key as FeatureKey;
    if (!spec.options.includes(values[k])) errors[k] = "Choose an option.";
  }
  const tenure = Number(values.tenure);
  const total = Number(values.TotalCharges);
  const monthly = Number(values.MonthlyCharges);
  if (!errors.tenure && !errors.TotalCharges && tenure === 0 && total !== 0) {
    errors.TotalCharges = "Must be 0 for a customer with 0 months of tenure.";
  }
  if (!errors.tenure && !errors.TotalCharges && !errors.MonthlyCharges && tenure > 0 && total > monthly * tenure * 3 + 100) {
    errors.TotalCharges = "Much higher than tenure × monthly charges allows. Please check it.";
  }
  return errors;
}

export function toPayload(values: FormValues): CustomerInput {
  return {
    ...(values as unknown as CustomerInput),
    tenure: Number(values.tenure),
    MonthlyCharges: Number(values.MonthlyCharges),
    TotalCharges: Number(values.TotalCharges),
  };
}

export function fromCustomer(c: CustomerInput): FormValues {
  const out = { ...DEFAULT_VALUES };
  for (const k of ALL_FIELDS) out[k] = String(c[k]);
  return out;
}

export function estimateTotal(values: FormValues): string | null {
  const t = Number(values.tenure);
  const m = Number(values.MonthlyCharges);
  if (values.tenure.trim() === "" || values.MonthlyCharges.trim() === "" || !Number.isFinite(t) || !Number.isFinite(m)) return null;
  return (Math.round(t * m * 100) / 100).toString();
}
