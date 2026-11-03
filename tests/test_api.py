"""API and recommendation-engine tests against the real trained model."""
import json

import pytest

from .conftest import ROOT


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "model_loaded": True, "model_version": "1.0.0", "detail": None}


def test_model_info(client):
    r = client.get("/model-info")
    assert r.status_code == 200
    body = r.json()
    assert body["model_name"]
    assert body["features"]["order"][0] == "SeniorCitizen"
    assert 0 < body["threshold"]["value"] < 1
    assert "IBM" in body["dataset"]["name"]
    assert body["limitations"]


def test_predict_valid_customer(client, customer):
    r = client.post("/predict", json=customer)
    assert r.status_code == 200
    body = r.json()
    pred, exp = body["prediction"], body["explanation"]
    assert 0 <= pred["probability"] <= 1
    assert pred["will_churn"] == (pred["probability"] >= pred["threshold"])
    assert pred["risk_band"] in {"Low", "Medium", "High"}
    assert len(exp["contributions"]) == 18
    assert all(c["shap_value"] > 0 for c in exp["top_increasing"])
    assert all(c["shap_value"] < 0 for c in exp["top_decreasing"])
    total = exp["base_value"] + sum(c["shap_value"] for c in exp["contributions"])
    assert abs(total - exp["model_output"]) < 1e-3
    assert "not proven causes" in exp["note"]


def test_recommendations_are_grounded_in_explanation(client, customer):
    body = client.post("/predict", json=customer).json()
    contribs = {c["feature"]: c for c in body["explanation"]["contributions"]}
    recs = body["recommendations"]
    assert recs[0]["id"] in {"proactive-contact", "watchlist", "maintain"}
    for rec in recs[1:]:
        assert rec["drivers"], rec
        for d in rec["drivers"]:
            assert contribs[d]["shap_value"] > 0, f"{rec['id']} cites a factor that lowers risk"
        assert rec["evidence"] and rec["assumption"]
    ids = {r["id"] for r in recs}
    assert "contract-upgrade" in ids  # month-to-month and positive SHAP
    assert "auto-pay" in ids  # electronic check
    assert "pricing-review" not in ids  # $29.85 is below average, so no pricing advice


def test_low_risk_customer(client, loyal):
    body = client.post("/predict", json=loyal).json()
    assert body["prediction"]["risk_band"] == "Low"
    assert body["prediction"]["will_churn"] is False
    assert body["recommendations"][0]["id"] == "maintain"
    assert "contract-upgrade" not in {r["id"] for r in body["recommendations"]}


def test_missing_field_returns_422(client, customer):
    customer.pop("Contract")
    r = client.post("/predict", json=customer)
    assert r.status_code == 422
    body = r.json()
    assert body["error"] == "invalid_input"
    assert any(d["field"] == "Contract" for d in body["details"])


@pytest.mark.parametrize(
    "field,value",
    [
        ("Contract", "Weekly"),
        ("tenure", -1),
        ("tenure", 1.5),
        ("tenure", "abc"),
        ("MonthlyCharges", 9999),
        ("PaymentMethod", None),
    ],
)
def test_invalid_values_return_422(client, customer, field, value):
    customer[field] = value
    r = client.post("/predict", json=customer)
    assert r.status_code == 422
    assert any(d["field"] == field for d in r.json()["details"])


def test_unexpected_field_rejected(client, customer):
    customer["gender"] = "Female"
    assert client.post("/predict", json=customer).status_code == 422


def test_business_rule_inconsistency_rejected(client, customer):
    customer["InternetService"] = "No"  # add-ons still say "No"/"Yes"
    r = client.post("/predict", json=customer)
    assert r.status_code == 422
    assert "No internet service" in r.json()["details"][0]["message"]


def test_malformed_json(client):
    r = client.post("/predict", content=b"{not json", headers={"content-type": "application/json"})
    assert r.status_code == 422


def test_payload_too_large(client):
    r = client.post("/predict", content=b"x" * 20000, headers={"content-type": "application/json"})
    assert r.status_code == 413


def test_cors_allows_dev_origin_only(client):
    ok = client.options("/predict", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5173"
    bad = client.options("/predict", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in bad.headers


def test_analytics_and_samples(client):
    a = client.get("/analytics/overview").json()
    assert a["totals"]["customers"] == 7043
    assert a["top_risk_customers"]
    s = client.get("/samples").json()
    assert len(s["samples"]) == 3 and "Demonstration" in s["note"]


def test_samples_predict_into_their_labelled_bands(client):
    samples = client.get("/samples").json()["samples"]
    for sample in samples:
        band = client.post("/predict", json=sample["features"]).json()["prediction"]["risk_band"]
        assert sample["label"].startswith(band)


def test_top_risk_customer_prediction_matches_stored_score(client):
    top = client.get("/analytics/overview").json()["top_risk_customers"][0]
    p = client.post("/predict", json=top["features"]).json()["prediction"]["probability"]
    assert abs(p - top["probability"]) < 1e-3


def test_unavailable_model(broken_client, customer):
    h = broken_client.get("/health")
    assert h.status_code == 503 and h.json()["model_loaded"] is False
    r = broken_client.post("/predict", json=customer)
    assert r.status_code == 503
    assert r.json()["error"] == "model_unavailable"
    assert "Traceback" not in r.text


def test_unknown_route_is_json_404(client):
    r = client.get("/does-not-exist")
    assert r.status_code == 404 and r.json()["error"] == "http_error"


def test_no_secrets_in_responses(client):
    text = json.dumps(client.get("/model-info").json())
    assert str(ROOT) not in text


def test_non_ascii_labels_survive_loading(client):
    """Tenure bands use an en dash; artifacts must be read as UTF-8 on every OS (e.g. Windows)."""
    bands = [r["group"] for r in client.get("/analytics/overview").json()["churn_by_tenure_band"]]
    assert bands[0] == "0–6"
