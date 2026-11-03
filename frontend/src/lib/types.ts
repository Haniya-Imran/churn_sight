export type RiskBand = "Low" | "Medium" | "High";

export type CustomerInput = {
  SeniorCitizen: string;
  Partner: string;
  Dependents: string;
  tenure: number;
  PhoneService: string;
  MultipleLines: string;
  InternetService: string;
  OnlineSecurity: string;
  OnlineBackup: string;
  DeviceProtection: string;
  TechSupport: string;
  StreamingTV: string;
  StreamingMovies: string;
  Contract: string;
  PaperlessBilling: string;
  PaymentMethod: string;
  MonthlyCharges: number;
  TotalCharges: number;
};

export type FeatureKey = keyof CustomerInput;

export type Contribution = {
  feature: FeatureKey;
  label: string;
  value: string | number;
  shap_value: number;
  direction: "increases_risk" | "decreases_risk";
  impact_pct_points: number;
};

export type Recommendation = {
  id: string;
  title: string;
  priority: "High" | "Medium" | "Low";
  action: string;
  why: string;
  evidence: string[];
  assumption: string;
  drivers: string[];
};

export type PredictResponse = {
  prediction: {
    probability: number;
    will_churn: boolean;
    label: string;
    risk_band: RiskBand;
    threshold: number;
    high_risk_cutoff: number;
  };
  explanation: {
    method: string;
    output_space: string;
    base_value: number;
    base_probability: number;
    model_output: number;
    summary: string;
    top_increasing: Contribution[];
    top_decreasing: Contribution[];
    contributions: Contribution[];
    note: string;
  };
  recommendations: Recommendation[];
  model: { name: string; version: string };
  generated_at: string;
};

export type NumericSpec = { label: string; unit: string; help: string; min: number; max: number; step: number; integer: boolean };
export type CategoricalSpec = { label: string; help: string; options: string[] };

export type Metrics = {
  threshold: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  roc_auc: number;
  pr_auc: number;
  brier: number;
  confusion_matrix: { tn: number; fp: number; fn: number; tp: number };
};

export type ModelInfo = {
  model_name: string;
  model_version: string;
  trained_at: string;
  dataset: { name: string; repository: string; license: string; description: string; rows: number; churn_rate: number };
  split: { test_size: number; stratified: boolean; random_state: number; train_rows: number; test_rows: number };
  class_imbalance: { train_churn_rate: number; strategy: string };
  selection_rule: string;
  comparison: { model: string; complexity_rank: number; cv_out_of_fold: Metrics }[];
  threshold: { value: number; method: string };
  risk_bands: { Low: string; Medium: string; High: string; high_cutoff: number };
  test_metrics: Metrics;
  test_metrics_at_0_5: Metrics;
  baseline_test_metrics: Metrics;
  overfitting_check: { train_roc_auc: number; test_roc_auc: number; gap: number; verdict: string };
  error_analysis: { false_positives: number; false_negatives: number; false_positive_meaning: string; false_negative_meaning: string };
  shap: { method: string; output_space: string; background_rows: number; base_value: number; note: string };
  global_importance: { feature: string; label: string; mean_abs_shap: number }[];
  features: { order: FeatureKey[]; numeric: Record<string, NumericSpec>; categorical: Record<string, CategoricalSpec> };
  limitations: string[];
};

export type RateRow = { group: string; churn_rate: number; customers: number; churned: number };

export type RiskCustomer = {
  customer_id: string;
  probability: number;
  band: RiskBand;
  actual_churn: boolean;
  features: CustomerInput;
};

export type Analytics = {
  source: string;
  totals: {
    customers: number;
    churned: number;
    churn_rate: number;
    retention_rate: number;
    avg_tenure_months: number;
    avg_monthly_charges: number;
    monthly_revenue_churned_customers: number;
    monthly_revenue_total: number;
  };
  churn_by_contract: RateRow[];
  churned_share_by_contract: { group: string; share: number }[];
  churn_by_tenure_band: RateRow[];
  churn_by_internet: RateRow[];
  churn_by_payment: RateRow[];
  churn_by_tech_support: RateRow[];
  test_set: {
    customers: number;
    band_counts: Record<RiskBand, number>;
    actual_churn_rate_by_band: Record<RiskBand, number>;
    predicted_to_churn: number;
  };
  high_vs_low_risk: {
    high_risk_customers: number;
    low_risk_customers: number;
    high: Record<string, number>;
    low: Record<string, number>;
  };
  top_risk_customers: RiskCustomer[];
  global_importance: { feature: string; label: string; mean_abs_shap: number }[];
  threshold: number;
  high_risk_cutoff: number;
  test_metrics: Metrics;
};

export type Sample = { label: string; customer_id: string; note: string; features: CustomerInput };
export type SamplesResponse = { note: string; samples: Sample[] };
