"""Tests for data preparation, the saved model and SHAP explanations."""
import json

import joblib
import numpy as np
import pandas as pd
import pytest

from ml.explain import ChurnExplainer, ExplanationError
from ml.features import (
    CATEGORICAL_FEATURES,
    FEATURE_ORDER,
    NUMERIC_FEATURES,
    clean,
    consistency_errors,
    load_raw,
    to_frame,
)

from .conftest import LOYAL_CUSTOMER, ROOT, VALID_CUSTOMER

MODELS = ROOT / "models"
DATA = ROOT / "data" / "raw" / "Telco-Customer-Churn.csv"


@pytest.fixture(scope="module")
def pipeline():
    return joblib.load(MODELS / "churn_pipeline.joblib")


@pytest.fixture(scope="module")
def explainer(pipeline):
    return ChurnExplainer(pipeline, joblib.load(MODELS / "shap_background.joblib"))


@pytest.fixture(scope="module")
def data():
    return clean(load_raw(DATA))


def test_dataset_schema_and_cleaning(data):
    assert len(data) == 7043
    assert data["TotalCharges"].isna().sum() == 0
    assert set(data["Churn"].unique()) == {0, 1}
    assert data["SeniorCitizen"].isin(["No", "Yes"]).all()
    assert 0.25 < data["Churn"].mean() < 0.28


def test_every_dataset_row_passes_the_api_rules(data):
    rows = data[FEATURE_ORDER].to_dict(orient="records")
    assert sum(1 for r in rows if consistency_errors(r)) == 0


def test_feature_order_matches_saved_metadata():
    meta = json.loads((MODELS / "model_metadata.json").read_text(encoding="utf-8"))
    assert meta["features"]["order"] == FEATURE_ORDER
    assert set(meta["features"]["categorical"]) == set(CATEGORICAL_FEATURES)
    assert set(meta["features"]["numeric"]) == set(NUMERIC_FEATURES)


def test_to_frame_enforces_column_order():
    shuffled = dict(reversed(list(VALID_CUSTOMER.items())))
    frame = to_frame([shuffled])
    assert list(frame.columns) == FEATURE_ORDER


def test_pipeline_outputs_valid_probabilities(pipeline):
    frame = to_frame([VALID_CUSTOMER, LOYAL_CUSTOMER])
    proba = pipeline.predict_proba(frame)
    assert proba.shape == (2, 2)
    assert np.allclose(proba.sum(axis=1), 1)
    assert list(pipeline.classes_) == [0, 1]  # column 1 == churn
    # A brand-new month-to-month customer should be riskier than a 70-month two-year customer.
    assert proba[0, 1] > proba[1, 1]


def test_unknown_category_is_rejected_by_pipeline(pipeline):
    bad = dict(VALID_CUSTOMER, Contract="Weekly")
    with pytest.raises(ValueError):
        pipeline.predict_proba(to_frame([bad]))


def test_shap_values_add_up_to_model_output(pipeline, explainer):
    frame = to_frame([VALID_CUSTOMER, LOYAL_CUSTOMER])
    results = explainer.explain(frame)
    proba = pipeline.predict_proba(frame)[:, 1]
    for res, p in zip(results, proba):
        total = res["base_value"] + sum(c["shap_value"] for c in res["contributions"])
        assert abs(total - np.log(p / (1 - p))) < 1e-3
        assert abs(res["probability"] - p) < 1e-9
        assert {c["feature"] for c in res["contributions"]} == set(FEATURE_ORDER)


def test_shap_directions_are_sensible(explainer):
    res = explainer.explain(to_frame([VALID_CUSTOMER]))[0]
    by = {c["feature"]: c for c in res["contributions"]}
    assert by["tenure"]["direction"] == "increases_risk"  # 1 month of tenure
    assert by["Contract"]["direction"] == "increases_risk"  # month-to-month
    loyal = {c["feature"]: c for c in explainer.explain(to_frame([LOYAL_CUSTOMER]))[0]["contributions"]}
    assert loyal["Contract"]["direction"] == "decreases_risk"  # two-year contract


def test_explainer_rejects_non_additive_results(pipeline, explainer, monkeypatch):
    original = explainer.grouped_shap

    def corrupted(X):
        values, base, names = original(X)
        return values + 0.5, base, names

    monkeypatch.setattr(explainer, "grouped_shap", corrupted)
    with pytest.raises(ExplanationError):
        explainer.explain(to_frame([VALID_CUSTOMER]))


def test_tree_explainer_path_is_additive():
    """The explainer also supports tree models (used if LightGBM is ever selected)."""
    from lightgbm import LGBMClassifier
    from sklearn.pipeline import Pipeline

    from ml.train import make_preprocessor

    df = clean(load_raw(DATA)).sample(1500, random_state=0)
    pipe = Pipeline([("prep", make_preprocessor()), ("model", LGBMClassifier(n_estimators=50, verbose=-1, random_state=0))])
    pipe.fit(df[FEATURE_ORDER], df["Churn"])
    exp = ChurnExplainer(pipe, df[FEATURE_ORDER].head(100))
    out = exp.explain(to_frame([VALID_CUSTOMER]))[0]
    assert out["output_space"] == "log-odds"


def test_metadata_metrics_are_real_and_consistent():
    meta = json.loads((MODELS / "model_metadata.json").read_text(encoding="utf-8"))
    m = meta["test_metrics"]
    cm = m["confusion_matrix"]
    assert cm["tn"] + cm["fp"] + cm["fn"] + cm["tp"] == meta["split"]["test_rows"]
    precision = cm["tp"] / (cm["tp"] + cm["fp"])
    recall = cm["tp"] / (cm["tp"] + cm["fn"])
    assert abs(precision - m["precision"]) < 1e-3
    assert abs(recall - m["recall"]) < 1e-3
    assert m["roc_auc"] > meta["baseline_test_metrics"]["roc_auc"]


def test_analytics_matches_dataset(data):
    a = json.loads((MODELS / "analytics.json").read_text(encoding="utf-8"))
    assert a["totals"]["customers"] == len(data)
    assert a["totals"]["churned"] == int(data["Churn"].sum())
    mtm = data[data["Contract"] == "Month-to-month"]["Churn"].mean()
    row = next(r for r in a["churn_by_contract"] if r["group"] == "Month-to-month")
    assert abs(row["churn_rate"] - mtm) < 1e-4
    ids = set(pd.read_csv(DATA)["customerID"])
    assert all(c["customer_id"] in ids for c in a["top_risk_customers"])
