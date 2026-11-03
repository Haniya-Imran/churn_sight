"""Request and response schemas.

The customer input model is generated from `ml.features`, the same module the
training script uses, so the API can never accept a field or category the
model was not trained on.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, create_model, model_validator

from ml.features import CATEGORICAL_FEATURES, FEATURE_ORDER, NUMERIC_FEATURES, consistency_errors


class _CustomerBase(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    @model_validator(mode="after")
    def _business_rules(self):
        errors = consistency_errors(self.model_dump())
        if errors:
            raise ValueError(" ".join(errors))
        return self


def _field_definitions() -> dict:
    defs: dict = {}
    for name in FEATURE_ORDER:
        if name in NUMERIC_FEATURES:
            spec = NUMERIC_FEATURES[name]
            py_type = int if spec["integer"] else float
            defs[name] = (
                py_type,
                Field(..., ge=spec["min"], le=spec["max"], description=f"{spec['help']} ({spec['unit']})"),
            )
        else:
            spec = CATEGORICAL_FEATURES[name]
            defs[name] = (Literal[tuple(spec["options"])], Field(..., description=spec["help"]))
    return defs


CustomerInput = create_model("CustomerInput", __base__=_CustomerBase, **_field_definitions())


class Contribution(BaseModel):
    feature: str
    label: str
    value: str | float | int
    shap_value: float = Field(description="SHAP contribution in log-odds; positive raises churn risk.")
    direction: Literal["increases_risk", "decreases_risk"]
    impact_pct_points: float = Field(
        description="Approximate change in churn probability (percentage points) attributable to this factor."
    )


class Prediction(BaseModel):
    probability: float
    will_churn: bool
    label: str
    risk_band: Literal["Low", "Medium", "High"]
    threshold: float
    high_risk_cutoff: float


class Explanation(BaseModel):
    method: str
    output_space: str
    base_value: float
    base_probability: float
    model_output: float
    summary: str
    top_increasing: list[Contribution]
    top_decreasing: list[Contribution]
    contributions: list[Contribution]
    note: str


class Recommendation(BaseModel):
    id: str
    title: str
    priority: Literal["High", "Medium", "Low"]
    action: str
    why: str
    evidence: list[str]
    assumption: str
    drivers: list[str]


class ModelRef(BaseModel):
    name: str
    version: str


class PredictResponse(BaseModel):
    prediction: Prediction
    explanation: Explanation
    recommendations: list[Recommendation]
    model: ModelRef
    generated_at: str


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    model_loaded: bool
    model_version: str | None = None
    detail: str | None = None


class ErrorResponse(BaseModel):
    error: str
    message: str
    details: list[dict] | None = None
