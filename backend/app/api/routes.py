"""HTTP routes."""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from ..schemas import CustomerInput, ErrorResponse, HealthResponse, PredictResponse
from ..services.explanations import build_explanation
from ..services.model_service import ModelService
from ..services.recommendations import recommend

logger = logging.getLogger("churnsight.api")
router = APIRouter()

ERRORS = {
    422: {"model": ErrorResponse, "description": "Invalid input"},
    503: {"model": ErrorResponse, "description": "Model not available"},
}


def service(request: Request) -> ModelService:
    return request.app.state.model_service


@router.get("/health", response_model=HealthResponse, tags=["system"])
def health(request: Request):
    svc = service(request)
    if svc.ready:
        return HealthResponse(status="ok", model_loaded=True, model_version=svc.metadata.get("model_version"))
    return JSONResponse(
        status_code=503,
        content=HealthResponse(status="degraded", model_loaded=False, detail=svc.load_error).model_dump(),
    )


@router.get("/model-info", tags=["model"], responses=ERRORS)
def model_info(request: Request):
    svc = service(request)
    svc.require_ready()
    m = svc.metadata
    return {
        "model_name": m["model_name"],
        "model_version": m["model_version"],
        "trained_at": m["trained_at"],
        "dataset": {k: m["dataset"][k] for k in ("name", "repository", "license", "description")}
        | {"rows": m["dataset"]["quality"]["rows"], "churn_rate": m["dataset"]["quality"]["churn_rate"]},
        "split": m["split"],
        "class_imbalance": m["class_imbalance"],
        "selection_rule": m["selection_rule"],
        "comparison": m["comparison"],
        "threshold": m["threshold"],
        "risk_bands": m["risk_bands"],
        "test_metrics": m["test_metrics"],
        "test_metrics_at_0_5": m["test_metrics_at_0_5"],
        "baseline_test_metrics": m["baseline_test_metrics"],
        "overfitting_check": m["overfitting_check"],
        "error_analysis": m["error_analysis"],
        "shap": m["shap"],
        "global_importance": m["global_importance"],
        "features": m["features"],
        "limitations": [
            "Trained on IBM's fictional Telco sample data; patterns may differ for a real business.",
            "Probabilities are estimates from historical patterns, not certainties.",
            "SHAP explains the model's behaviour, not proven causes of churn.",
            "Correlated inputs (tenure and total charges) can share or offset credit in the explanation.",
            "The model does not see complaints, usage, competitor offers or customer feedback.",
        ],
    }


@router.post("/predict", response_model=PredictResponse, tags=["model"], responses=ERRORS)
def predict(customer: CustomerInput, request: Request):
    svc = service(request)
    started = time.perf_counter()
    data = customer.model_dump()
    prediction, raw = svc.predict_and_explain(data)
    explanation = build_explanation(raw)
    recs = recommend(data, prediction, explanation, svc.analytics)
    # Log outcome only, never the customer's attributes.
    logger.info(
        "prediction band=%s latency_ms=%.1f", prediction["risk_band"], (time.perf_counter() - started) * 1000
    )
    return {
        "prediction": prediction,
        "explanation": explanation,
        "recommendations": recs,
        "model": {"name": svc.metadata["model_name"], "version": svc.metadata["model_version"]},
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


@router.get("/analytics/overview", tags=["analytics"], responses=ERRORS)
def analytics_overview(request: Request):
    svc = service(request)
    svc.require_ready()
    a = svc.analytics
    return {
        "source": a["source"],
        "totals": a["totals"],
        "churn_by_contract": a["churn_by_contract"],
        "churned_share_by_contract": a["churned_share_by_contract"],
        "churn_by_tenure_band": a["churn_by_tenure_band"],
        "churn_by_internet": a["churn_by_internet"],
        "churn_by_payment": a["churn_by_payment"],
        "churn_by_tech_support": a["churn_by_tech_support"],
        "test_set": a["test_set"],
        "high_vs_low_risk": a["high_vs_low_risk"],
        "top_risk_customers": a["top_risk_customers"],
        "global_importance": a["global_importance"],
        "threshold": svc.threshold,
        "high_risk_cutoff": svc.high_cutoff,
        "test_metrics": svc.metadata["test_metrics"],
    }


@router.get("/samples", tags=["analytics"], responses=ERRORS)
def samples(request: Request):
    svc = service(request)
    svc.require_ready()
    return {"note": "Demonstration data: real customers from the IBM Telco sample dataset's held-out test split.", "samples": svc.samples}
