"""SHAP explanations for the fitted churn pipeline.

SHAP values are computed on the model's transformed (one-hot / scaled) inputs
and then summed back to the original business features. Summing is valid
because SHAP values are additive, so `base_value + sum(contributions)` still
equals the model's output for that customer. This is checked on every call.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
import shap
from sklearn.ensemble import ExtraTreesClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline

from .features import CATEGORICAL_FEATURES, FEATURE_LABELS, NUMERIC_FEATURES

ADDITIVITY_TOLERANCE = 1e-3


class ExplanationError(RuntimeError):
    """Raised when a SHAP explanation cannot be produced or fails verification."""


def _sigmoid(x: np.ndarray | float) -> np.ndarray | float:
    return 1.0 / (1.0 + np.exp(-x))


def _logit(p: np.ndarray) -> np.ndarray:
    p = np.clip(p, 1e-12, 1 - 1e-12)
    return np.log(p / (1 - p))


@dataclass
class FeatureContribution:
    feature: str
    label: str
    value: str | float
    shap_value: float
    impact_pct_points: float

    def to_dict(self) -> dict:
        return {
            "feature": self.feature,
            "label": self.label,
            "value": self.value,
            "shap_value": round(self.shap_value, 5),
            "direction": "increases_risk" if self.shap_value > 0 else "decreases_risk",
            "impact_pct_points": round(self.impact_pct_points, 2),
        }


class ChurnExplainer:
    """Wraps a SHAP explainer that matches the type of the fitted model."""

    def __init__(self, pipeline: Pipeline, background: pd.DataFrame):
        self.pipeline = pipeline
        self.prep = pipeline.named_steps["prep"]
        self.model = pipeline.named_steps["model"]
        bg = np.asarray(self.prep.transform(background), dtype=float)
        self._groups = self._build_groups()

        if isinstance(self.model, LogisticRegression):
            self.method = "shap.LinearExplainer (interventional, independent masker)"
            self._explainer = shap.LinearExplainer(self.model, shap.maskers.Independent(bg, max_samples=len(bg)))
            self.output_space = "log-odds"
        else:
            # Forests average probabilities, so their raw output is a probability;
            # boosted trees (LightGBM) output log-odds.
            forest = isinstance(self.model, (RandomForestClassifier, ExtraTreesClassifier))
            self.output_space = "probability" if forest else "log-odds"
            self.method = f"shap.TreeExplainer (interventional, raw {self.output_space} output)"
            self._explainer = shap.TreeExplainer(
                self.model, data=bg, feature_perturbation="interventional", model_output="raw"
            )

    # -- mapping transformed columns back to business features --------------
    def _build_groups(self) -> dict[str, list[int]]:
        groups: dict[str, list[int]] = {}
        idx = 0
        for name, transformer, cols in self.prep.transformers_:
            if name == "remainder":
                continue
            if name == "num":
                for col in cols:
                    groups[col] = [idx]
                    idx += 1
            elif name == "cat":
                for col, cats in zip(cols, transformer.categories_):
                    groups[col] = list(range(idx, idx + len(cats)))
                    idx += len(cats)
        n_out = len(self.prep.get_feature_names_out())
        if idx != n_out:
            raise ExplanationError("Feature mapping does not cover every transformed column.")
        return groups

    def _class1(self, values) -> np.ndarray:
        """Normalise the various SHAP output layouts to (n_rows, n_features) for class 1."""
        if isinstance(values, list):
            values = values[1]
        values = np.asarray(values, dtype=float)
        if values.ndim == 3:
            values = values[:, :, 1]
        return values

    def _base_value(self) -> float:
        ev = np.atleast_1d(np.asarray(self._explainer.expected_value, dtype=float))
        return float(ev[1] if ev.size == 2 else ev[0])

    def raw_shap(self, X: pd.DataFrame) -> tuple[np.ndarray, float]:
        Xt = np.asarray(self.prep.transform(X), dtype=float)
        values = self._class1(self._explainer.shap_values(Xt))
        return values, self._base_value()

    def grouped_shap(self, X: pd.DataFrame) -> tuple[np.ndarray, float, list[str]]:
        values, base = self.raw_shap(X)
        names = list(self._groups)
        grouped = np.column_stack([values[:, self._groups[n]].sum(axis=1) for n in names])
        return grouped, base, names

    def explain(self, X: pd.DataFrame) -> list[dict]:
        """Explain each row of X (raw, validated features). Verifies additivity."""
        try:
            grouped, base, names = self.grouped_shap(X)
        except ExplanationError:
            raise
        except Exception as exc:  # pragma: no cover - defensive
            raise ExplanationError(f"SHAP computation failed: {type(exc).__name__}") from exc

        proba = self.pipeline.predict_proba(X)[:, 1]
        log_odds = self.output_space == "log-odds"
        model_out = _logit(proba) if log_odds else proba
        reconstructed = base + grouped.sum(axis=1)
        if not np.allclose(reconstructed, model_out, atol=ADDITIVITY_TOLERANCE):
            raise ExplanationError("SHAP values do not add up to the model output; explanation rejected.")

        results = []
        for i in range(len(X)):
            row = X.iloc[i]
            contributions = []
            for j, name in enumerate(names):
                phi = float(grouped[i, j])
                value = row[name]
                if name in NUMERIC_FEATURES:
                    value = float(value)
                    if NUMERIC_FEATURES[name]["integer"]:
                        value = int(round(value))
                # Approximate change in churn probability attributable to this factor:
                # p(with factor) - p(with this factor's contribution removed).
                if log_odds:
                    impact = (float(_sigmoid(model_out[i])) - float(_sigmoid(model_out[i] - phi))) * 100
                else:
                    impact = phi * 100
                contributions.append(
                    FeatureContribution(name, FEATURE_LABELS[name], value, phi, impact)
                )
            contributions.sort(key=lambda c: abs(c.shap_value), reverse=True)
            results.append(
                {
                    "base_value": round(base, 5),
                    "base_probability": round(float(_sigmoid(base) if log_odds else base), 5),
                    "model_output": round(float(model_out[i]), 5),
                    "probability": float(proba[i]),
                    "output_space": self.output_space,
                    "method": self.method,
                    "contributions": [c.to_dict() for c in contributions],
                }
            )
        return results

    def global_importance(self, X: pd.DataFrame) -> list[dict]:
        grouped, _, names = self.grouped_shap(X)
        mean_abs = np.abs(grouped).mean(axis=0)
        order = np.argsort(-mean_abs)
        return [
            {"feature": names[k], "label": FEATURE_LABELS[names[k]], "mean_abs_shap": round(float(mean_abs[k]), 5)}
            for k in order
        ]


def is_categorical(name: str) -> bool:
    return name in CATEGORICAL_FEATURES


__all__ = ["ChurnExplainer", "ExplanationError", "is_categorical"]
