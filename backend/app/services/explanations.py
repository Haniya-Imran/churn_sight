"""Turn raw SHAP contributions into a readable explanation."""
from __future__ import annotations

from ml.features import NUMERIC_FEATURES

TOP_N = 5

NOTE = (
    "SHAP shows how much each input pushed this model's score up or down for this customer. "
    "It describes the model's behaviour learned from historical data, not proven causes of churn."
)


def format_value(feature: str, value) -> str:
    if feature == "tenure":
        v = int(value)
        return f"{v} month" if v == 1 else f"{v} months"
    if feature in NUMERIC_FEATURES:
        return f"${float(value):,.2f}"
    return str(value)


def describe(contribution: dict) -> str:
    return f"{contribution['label']}: {format_value(contribution['feature'], contribution['value'])}"


def build_explanation(raw: dict) -> dict:
    contributions = raw["contributions"]
    increasing = sorted((c for c in contributions if c["shap_value"] > 0), key=lambda c: -c["shap_value"])[:TOP_N]
    decreasing = sorted((c for c in contributions if c["shap_value"] < 0), key=lambda c: c["shap_value"])[:TOP_N]
    p = raw["probability"] * 100
    base = raw["base_probability"] * 100

    parts = [
        f"The model estimates a {p:.0f}% chance that this customer will churn, compared with "
        f"{base:.0f}% for a typical customer in the reference sample."
    ]
    if increasing:
        parts.append("The biggest factors raising the risk are " + _join([describe(c) for c in increasing[:3]]) + ".")
    if decreasing:
        parts.append("Factors lowering the risk are " + _join([describe(c) for c in decreasing[:2]]) + ".")
    return {
        "method": raw["method"],
        "output_space": raw["output_space"],
        "base_value": raw["base_value"],
        "base_probability": raw["base_probability"],
        "model_output": raw["model_output"],
        "summary": " ".join(parts),
        "top_increasing": increasing,
        "top_decreasing": decreasing,
        "contributions": contributions,
        "note": NOTE,
    }


def _join(items: list[str]) -> str:
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]
