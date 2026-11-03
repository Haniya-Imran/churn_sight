"""Loads model artifacts once and serves predictions + SHAP explanations."""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

import joblib

from ml.explain import ChurnExplainer
from ml.features import FEATURE_ORDER, to_frame

logger = logging.getLogger("churnsight.model")

REQUIRED_FILES = [
    "churn_pipeline.joblib",
    "shap_background.joblib",
    "model_metadata.json",
    "analytics.json",
    "sample_customers.json",
]


class ModelUnavailableError(RuntimeError):
    """The model artifacts are missing or could not be loaded."""


@dataclass
class ModelService:
    models_dir: Path
    pipeline: object | None = None
    explainer: ChurnExplainer | None = None
    metadata: dict = field(default_factory=dict)
    analytics: dict = field(default_factory=dict)
    samples: list = field(default_factory=list)
    load_error: str | None = None

    def load(self) -> None:
        try:
            missing = [f for f in REQUIRED_FILES if not (self.models_dir / f).exists()]
            if missing:
                raise ModelUnavailableError(
                    f"Missing model artifacts: {', '.join(missing)}. Run `python -m ml.train` first."
                )
            self.pipeline = joblib.load(self.models_dir / "churn_pipeline.joblib")
            background = joblib.load(self.models_dir / "shap_background.joblib")
            self.metadata = json.loads((self.models_dir / "model_metadata.json").read_text(encoding="utf-8"))
            self.analytics = json.loads((self.models_dir / "analytics.json").read_text(encoding="utf-8"))
            self.samples = json.loads((self.models_dir / "sample_customers.json").read_text(encoding="utf-8"))
            if self.metadata["features"]["order"] != FEATURE_ORDER:
                raise ModelUnavailableError("Saved model feature order does not match the application schema.")
            self.explainer = ChurnExplainer(self.pipeline, background)
            self.load_error = None
            logger.info("Model loaded: %s v%s", self.metadata["model_name"], self.metadata["model_version"])
        except ModelUnavailableError as exc:
            self._fail(str(exc))
        except Exception as exc:  # corrupt/incompatible artifacts
            self._fail(f"Model artifacts could not be loaded ({type(exc).__name__}).")

    def _fail(self, message: str) -> None:
        self.pipeline = None
        self.explainer = None
        self.load_error = message
        logger.error("Model unavailable: %s", message)

    @property
    def ready(self) -> bool:
        return self.pipeline is not None and self.explainer is not None

    def require_ready(self) -> None:
        if not self.ready:
            raise ModelUnavailableError(self.load_error or "Model is not loaded.")

    @property
    def threshold(self) -> float:
        return float(self.metadata["threshold"]["value"])

    @property
    def high_cutoff(self) -> float:
        return float(self.metadata["risk_bands"]["high_cutoff"])

    def band(self, p: float) -> str:
        if p >= self.high_cutoff:
            return "High"
        if p >= self.threshold:
            return "Medium"
        return "Low"

    def predict_and_explain(self, customer: dict) -> tuple[dict, dict]:
        self.require_ready()
        frame = to_frame([customer])
        explanation = self.explainer.explain(frame)[0]
        p = float(explanation["probability"])
        prediction = {
            "probability": round(p, 4),
            "will_churn": p >= self.threshold,
            "label": "Likely to churn" if p >= self.threshold else "Likely to stay",
            "risk_band": self.band(p),
            "threshold": self.threshold,
            "high_risk_cutoff": self.high_cutoff,
        }
        return prediction, explanation
