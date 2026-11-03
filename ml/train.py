"""Train, compare, evaluate and save the ChurnSight churn model.

Run from the project root:
    python -m ml.train

Outputs (in ./models):
    churn_pipeline.joblib   fitted preprocessing + model (sklearn Pipeline)
    shap_background.joblib  raw training rows used as the SHAP background
    model_metadata.json     configuration, metrics, threshold, feature schema
    analytics.json          dashboard statistics computed from the real data
    sample_customers.json   real held-out customers for the demo mode
"""
from __future__ import annotations

import hashlib
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier
from sklearn.base import clone
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    brier_score_loss,
    confusion_matrix,
    f1_score,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import StratifiedKFold, cross_val_predict, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from .explain import ChurnExplainer
from .features import (
    CATEGORICAL_FEATURES,
    EXCLUDED_COLUMNS,
    FEATURE_ORDER,
    ID_COLUMN,
    NUMERIC_FEATURES,
    TARGET,
    clean,
    consistency_errors,
    load_raw,
)

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "raw" / "Telco-Customer-Churn.csv"
MODELS_DIR = ROOT / "models"
SEED = 42
TEST_SIZE = 0.2
CV_FOLDS = 5
BACKGROUND_SIZE = 200
HIGH_RISK_PROBABILITY = 0.60
SIMPLICITY_MARGIN = 0.005  # prefer the simpler model if within this PR-AUC of the best

DATASET_SOURCE = {
    "name": "IBM Telco Customer Churn",
    "url": "https://raw.githubusercontent.com/IBM/telco-customer-churn-on-icp4d/master/data/Telco-Customer-Churn.csv",
    "repository": "https://github.com/IBM/telco-customer-churn-on-icp4d",
    "license": "Apache License 2.0 (repository license)",
    "description": "Fictional telecommunications customers created by IBM as sample data.",
}


def make_preprocessor() -> ColumnTransformer:
    return ColumnTransformer(
        [
            ("num", StandardScaler(), list(NUMERIC_FEATURES)),
            (
                "cat",
                OneHotEncoder(
                    categories=[CATEGORICAL_FEATURES[c]["options"] for c in CATEGORICAL_FEATURES],
                    handle_unknown="error",
                    sparse_output=False,
                ),
                list(CATEGORICAL_FEATURES),
            ),
        ]
    )


def candidates() -> dict[str, tuple[object, int]]:
    """name -> (estimator, complexity rank). Lower rank = simpler/more interpretable."""
    return {
        "Baseline (predicts class prior)": (DummyClassifier(strategy="prior"), 0),
        "Logistic Regression": (LogisticRegression(C=0.5, max_iter=5000), 1),
        "Random Forest": (
            RandomForestClassifier(n_estimators=400, min_samples_leaf=8, max_features="sqrt", n_jobs=-1, random_state=SEED),
            3,
        ),
        "LightGBM": (
            LGBMClassifier(
                n_estimators=400,
                learning_rate=0.02,
                num_leaves=15,
                min_child_samples=40,
                subsample=0.8,
                subsample_freq=1,
                colsample_bytree=0.8,
                reg_lambda=1.0,
                random_state=SEED,
                verbose=-1,
            ),
            2,
        ),
    }


def metrics_at(y_true: np.ndarray, proba: np.ndarray, threshold: float) -> dict:
    pred = (proba >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_true, pred, labels=[0, 1]).ravel()
    return {
        "threshold": round(float(threshold), 4),
        "accuracy": round(accuracy_score(y_true, pred), 4),
        "precision": round(precision_score(y_true, pred, zero_division=0), 4),
        "recall": round(recall_score(y_true, pred), 4),
        "f1": round(f1_score(y_true, pred), 4),
        "roc_auc": round(roc_auc_score(y_true, proba), 4),
        "pr_auc": round(average_precision_score(y_true, proba), 4),
        "brier": round(brier_score_loss(y_true, proba), 4),
        "confusion_matrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
    }


def best_f1_threshold(y_true: np.ndarray, proba: np.ndarray) -> float:
    precision, recall, thresholds = precision_recall_curve(y_true, proba)
    f1 = 2 * precision * recall / np.clip(precision + recall, 1e-12, None)
    k = int(np.nanargmax(f1[:-1]))
    return float(thresholds[k])


def risk_band(p: float, threshold: float) -> str:
    if p >= HIGH_RISK_PROBABILITY:
        return "High"
    if p >= threshold:
        return "Medium"
    return "Low"


def rate_by(df: pd.DataFrame, col: str, order: list[str] | None = None) -> list[dict]:
    g = df.groupby(col, observed=True)[TARGET].agg(["mean", "count", "sum"])
    keys = order if order else list(g.index)
    return [
        {"group": str(k), "churn_rate": round(float(g.loc[k, "mean"]), 4), "customers": int(g.loc[k, "count"]), "churned": int(g.loc[k, "sum"])}
        for k in keys
        if k in g.index
    ]


def main() -> None:
    t0 = time.time()
    MODELS_DIR.mkdir(exist_ok=True)
    raw = load_raw(DATA_PATH)
    sha = hashlib.sha256(DATA_PATH.read_bytes()).hexdigest()
    df = clean(raw)

    # Data-quality report ----------------------------------------------------
    records = df[FEATURE_ORDER].to_dict(orient="records")
    rule_violations = sum(1 for r in records if consistency_errors(r))
    quality = {
        "rows": int(len(df)),
        "columns": int(raw.shape[1]),
        "missing_values_raw": int(raw.isna().sum().sum()),
        "blank_total_charges_filled_with_0": int((pd.to_numeric(raw["TotalCharges"], errors="coerce").isna()).sum()),
        "duplicate_customer_ids": int(raw[ID_COLUMN].duplicated().sum()),
        "duplicate_feature_rows_excluding_id": int(raw.drop(columns=[ID_COLUMN]).duplicated().sum()),
        "rows_violating_input_rules": int(rule_violations),
        "churn_rate": round(float(df[TARGET].mean()), 4),
        "excluded_columns": EXCLUDED_COLUMNS + [ID_COLUMN],
        "leakage_review": (
            "No post-churn fields are present. customerID is an identifier and is dropped. "
            "TotalCharges is strongly related to tenure x MonthlyCharges but is known at prediction time, so it is kept."
        ),
    }
    if rule_violations:
        raise SystemExit(f"{rule_violations} dataset rows violate the API input rules; rules must match the data.")
    print("Data quality:", json.dumps(quality, indent=2))

    X = df[FEATURE_ORDER]
    y = df[TARGET].to_numpy()
    ids = df[ID_COLUMN]
    X_train, X_test, y_train, y_test, id_train, id_test = train_test_split(
        X, y, ids, test_size=TEST_SIZE, stratify=y, random_state=SEED
    )

    # Model comparison with stratified CV on the training split only ---------
    cv = StratifiedKFold(n_splits=CV_FOLDS, shuffle=True, random_state=SEED)
    comparison = []
    oof_store: dict[str, np.ndarray] = {}
    for name, (est, rank) in candidates().items():
        pipe = Pipeline([("prep", make_preprocessor()), ("model", clone(est))])
        oof = cross_val_predict(pipe, X_train, y_train, cv=cv, method="predict_proba")[:, 1]
        oof_store[name] = oof
        thr = best_f1_threshold(y_train, oof) if name != "Baseline (predicts class prior)" else 0.5
        m = metrics_at(y_train, oof, thr)
        comparison.append({"model": name, "complexity_rank": rank, "cv_out_of_fold": m})
        print(f"{name:34s} ROC-AUC {m['roc_auc']:.4f}  PR-AUC {m['pr_auc']:.4f}  F1@{thr:.2f} {m['f1']:.4f}  Brier {m['brier']:.4f}")

    real = [c for c in comparison if c["complexity_rank"] > 0]
    best_pr = max(c["cv_out_of_fold"]["pr_auc"] for c in real)
    eligible = [c for c in real if c["cv_out_of_fold"]["pr_auc"] >= best_pr - SIMPLICITY_MARGIN]
    chosen = min(eligible, key=lambda c: (c["complexity_rank"], -c["cv_out_of_fold"]["pr_auc"]))
    chosen_name = chosen["model"]
    selection_rule = (
        f"Highest cross-validated PR-AUC on the training split; among models within {SIMPLICITY_MARGIN} PR-AUC of the best, "
        "the simplest / most interpretable is chosen. PR-AUC is used because the business cares about finding the "
        "minority churn class; ROC-AUC, F1 and Brier score are reported alongside."
    )
    print("Selected:", chosen_name)

    threshold = best_f1_threshold(y_train, oof_store[chosen_name])
    final = Pipeline([("prep", make_preprocessor()), ("model", clone(candidates()[chosen_name][0]))])
    final.fit(X_train, y_train)

    proba_test = final.predict_proba(X_test)[:, 1]
    proba_train = final.predict_proba(X_train)[:, 1]
    test_metrics = metrics_at(y_test, proba_test, threshold)
    test_metrics_default = metrics_at(y_test, proba_test, 0.5)
    train_metrics = metrics_at(y_train, proba_train, threshold)
    baseline_test = metrics_at(y_test, np.full_like(proba_test, y_train.mean()), 0.5)
    overfit_gap = round(train_metrics["roc_auc"] - test_metrics["roc_auc"], 4)
    print("Test:", test_metrics)

    # SHAP -------------------------------------------------------------------
    background = X_train.sample(n=BACKGROUND_SIZE, random_state=SEED)
    explainer = ChurnExplainer(final, background)
    check = explainer.explain(X_test.iloc[:50])  # raises if additivity fails
    importance = explainer.global_importance(X_test)

    grouped, base, names = explainer.grouped_shap(X_test)
    shap_df = pd.DataFrame(grouped, columns=names)

    # Analytics for the dashboard (real data only) -------------------------
    test_df = X_test.copy()
    test_df[ID_COLUMN] = id_test.to_numpy()
    test_df["actual_churn"] = y_test
    test_df["probability"] = proba_test
    test_df["band"] = [risk_band(p, threshold) for p in proba_test]

    tenure_bands = pd.cut(df["tenure"], bins=[-1, 6, 12, 24, 36, 48, 60, 72], labels=["0–6", "7–12", "13–24", "25–36", "37–48", "49–60", "61–72"])
    df_t = df.assign(tenure_band=tenure_bands.astype(str))

    def characteristic_share(frame: pd.DataFrame) -> dict:
        return {
            "Month-to-month contract": round(float((frame["Contract"] == "Month-to-month").mean()), 4),
            "Fiber optic internet": round(float((frame["InternetService"] == "Fiber optic").mean()), 4),
            "Electronic check payment": round(float((frame["PaymentMethod"] == "Electronic check").mean()), 4),
            "No tech support (has internet)": round(float((frame["TechSupport"] == "No").mean()), 4),
            "No online security (has internet)": round(float((frame["OnlineSecurity"] == "No").mean()), 4),
            "Tenure 12 months or less": round(float((frame["tenure"] <= 12).mean()), 4),
            "Paperless billing": round(float((frame["PaperlessBilling"] == "Yes").mean()), 4),
            "Average monthly charges (USD)": round(float(frame["MonthlyCharges"].mean()), 2),
            "Average tenure (months)": round(float(frame["tenure"].mean()), 1),
        }

    high = test_df[test_df["band"] == "High"]
    low = test_df[test_df["band"] == "Low"]
    band_counts = test_df["band"].value_counts().to_dict()
    band_actual = test_df.groupby("band")["actual_churn"].mean().round(4).to_dict()

    top = test_df.sort_values("probability", ascending=False).head(25)
    top_customers = [
        {
            "customer_id": r[ID_COLUMN],
            "probability": round(float(r["probability"]), 4),
            "band": r["band"],
            "actual_churn": bool(r["actual_churn"]),
            "features": {k: (int(r[k]) if k == "tenure" else float(r[k]) if k in NUMERIC_FEATURES else str(r[k])) for k in FEATURE_ORDER},
        }
        for _, r in top.iterrows()
    ]

    analytics = {
        "source": "Computed from the full IBM Telco dataset; risk figures use the model's scores on the 20% held-out test split.",
        "totals": {
            "customers": int(len(df)),
            "churned": int(df[TARGET].sum()),
            "churn_rate": round(float(df[TARGET].mean()), 4),
            "retention_rate": round(1 - float(df[TARGET].mean()), 4),
            "avg_tenure_months": round(float(df["tenure"].mean()), 1),
            "avg_monthly_charges": round(float(df["MonthlyCharges"].mean()), 2),
            "monthly_revenue_churned_customers": round(float(df.loc[df[TARGET] == 1, "MonthlyCharges"].sum()), 2),
            "monthly_revenue_total": round(float(df["MonthlyCharges"].sum()), 2),
        },
        "churn_by_contract": rate_by(df, "Contract", CATEGORICAL_FEATURES["Contract"]["options"]),
        "churn_by_tenure_band": rate_by(df_t, "tenure_band", ["0–6", "7–12", "13–24", "25–36", "37–48", "49–60", "61–72"]),
        "churn_by_internet": rate_by(df, "InternetService", CATEGORICAL_FEATURES["InternetService"]["options"]),
        "churn_by_payment": rate_by(df, "PaymentMethod", CATEGORICAL_FEATURES["PaymentMethod"]["options"]),
        "churn_by_tech_support": rate_by(df, "TechSupport", CATEGORICAL_FEATURES["TechSupport"]["options"]),
        "churn_rate_by_feature": {
            col: rate_by(df, col, spec["options"]) for col, spec in CATEGORICAL_FEATURES.items()
        },
        "churned_share_by_contract": [
            {"group": k, "share": round(float(v), 4)}
            for k, v in df.loc[df[TARGET] == 1, "Contract"].value_counts(normalize=True).reindex(CATEGORICAL_FEATURES["Contract"]["options"]).items()
        ],
        "test_set": {
            "customers": int(len(test_df)),
            "band_counts": {b: int(band_counts.get(b, 0)) for b in ["High", "Medium", "Low"]},
            "actual_churn_rate_by_band": {b: float(band_actual.get(b, 0.0)) for b in ["High", "Medium", "Low"]},
            "predicted_to_churn": int((proba_test >= threshold).sum()),
        },
        "high_vs_low_risk": {
            "high_risk_customers": int(len(high)),
            "low_risk_customers": int(len(low)),
            "high": characteristic_share(high),
            "low": characteristic_share(low),
        },
        "top_risk_customers": top_customers,
        "global_importance": importance,
        "mean_shap_by_feature": {n: round(float(shap_df[n].mean()), 5) for n in names},
    }

    # Demo customers: real held-out rows covering each risk band -------------
    demo = []
    for band, label in [("High", "High-risk example"), ("Medium", "Medium-risk example"), ("Low", "Low-risk example")]:
        subset = test_df[test_df["band"] == band].sort_values("probability", ascending=(band != "High"))
        if band == "Medium":
            subset = test_df[test_df["band"] == band].iloc[(test_df[test_df["band"] == band]["probability"] - (threshold + HIGH_RISK_PROBABILITY) / 2).abs().argsort()]
        if len(subset):
            r = subset.iloc[0]
            demo.append(
                {
                    "label": label,
                    "customer_id": r[ID_COLUMN],
                    "note": "Real customer from the held-out test set of the IBM Telco sample dataset (demonstration data).",
                    "features": {k: (int(r[k]) if k == "tenure" else float(r[k]) if k in NUMERIC_FEATURES else str(r[k])) for k in FEATURE_ORDER},
                }
            )

    false_pos = test_metrics["confusion_matrix"]["fp"]
    false_neg = test_metrics["confusion_matrix"]["fn"]
    metadata = {
        "model_name": chosen_name,
        "model_version": "1.0.0",
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "training_seconds": round(time.time() - t0, 1),
        "dataset": {**DATASET_SOURCE, "sha256": sha, "quality": quality},
        "split": {"test_size": TEST_SIZE, "stratified": True, "random_state": SEED, "train_rows": int(len(X_train)), "test_rows": int(len(X_test))},
        "class_imbalance": {
            "train_churn_rate": round(float(y_train.mean()), 4),
            "strategy": "No resampling or class weights, so predicted probabilities stay calibrated; the decision threshold is tuned instead.",
        },
        "selection_rule": selection_rule,
        "comparison": comparison,
        "threshold": {
            "value": round(threshold, 4),
            "method": "Threshold maximising F1 on 5-fold out-of-fold predictions of the training split (never tuned on the test set).",
        },
        "risk_bands": {
            "Low": f"probability < {threshold:.2f} (predicted to stay)",
            "Medium": f"{threshold:.2f} ≤ probability < {HIGH_RISK_PROBABILITY:.2f} (predicted to churn)",
            "High": f"probability ≥ {HIGH_RISK_PROBABILITY:.2f} (predicted to churn)",
            "high_cutoff": HIGH_RISK_PROBABILITY,
        },
        "test_metrics": test_metrics,
        "test_metrics_at_0_5": test_metrics_default,
        "baseline_test_metrics": baseline_test,
        "train_metrics": train_metrics,
        "overfitting_check": {
            "train_roc_auc": train_metrics["roc_auc"],
            "test_roc_auc": test_metrics["roc_auc"],
            "gap": overfit_gap,
            "verdict": "acceptable" if overfit_gap < 0.05 else "possible overfitting",
        },
        "error_analysis": {
            "false_positives": false_pos,
            "false_negatives": false_neg,
            "false_positive_meaning": "Customers flagged as likely to leave who actually stayed. Cost: a retention offer or call spent on someone who would have stayed.",
            "false_negative_meaning": "Customers who left but were not flagged. Cost: lost revenue with no chance to intervene. The F1-tuned threshold accepts more false positives to catch more of these.",
        },
        "shap": {
            "method": explainer.method,
            "output_space": explainer.output_space,
            "background_rows": BACKGROUND_SIZE,
            "base_value": round(base, 5),
            "additivity_verified_rows": len(check),
            "note": "SHAP describes how the model uses each input; it does not prove that a factor causes a customer to leave.",
        },
        "global_importance": importance,
        "features": {
            "order": FEATURE_ORDER,
            "numeric": NUMERIC_FEATURES,
            "categorical": CATEGORICAL_FEATURES,
        },
    }

    joblib.dump(final, MODELS_DIR / "churn_pipeline.joblib")
    joblib.dump(background, MODELS_DIR / "shap_background.joblib")
    (MODELS_DIR / "model_metadata.json").write_text(json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8")
    (MODELS_DIR / "analytics.json").write_text(json.dumps(analytics, indent=2, ensure_ascii=False), encoding="utf-8")
    (MODELS_DIR / "sample_customers.json").write_text(json.dumps(demo, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Saved artifacts to {MODELS_DIR} in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
