import copy
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.app.config import Settings  # noqa: E402
from backend.app.main import create_app  # noqa: E402

VALID_CUSTOMER = {
    "SeniorCitizen": "No",
    "Partner": "Yes",
    "Dependents": "No",
    "tenure": 1,
    "PhoneService": "No",
    "MultipleLines": "No phone service",
    "InternetService": "DSL",
    "OnlineSecurity": "No",
    "OnlineBackup": "Yes",
    "DeviceProtection": "No",
    "TechSupport": "No",
    "StreamingTV": "No",
    "StreamingMovies": "No",
    "Contract": "Month-to-month",
    "PaperlessBilling": "Yes",
    "PaymentMethod": "Electronic check",
    "MonthlyCharges": 29.85,
    "TotalCharges": 29.85,
}

LOYAL_CUSTOMER = {
    "SeniorCitizen": "No",
    "Partner": "Yes",
    "Dependents": "Yes",
    "tenure": 70,
    "PhoneService": "Yes",
    "MultipleLines": "Yes",
    "InternetService": "DSL",
    "OnlineSecurity": "Yes",
    "OnlineBackup": "Yes",
    "DeviceProtection": "Yes",
    "TechSupport": "Yes",
    "StreamingTV": "No",
    "StreamingMovies": "No",
    "Contract": "Two year",
    "PaperlessBilling": "No",
    "PaymentMethod": "Bank transfer (automatic)",
    "MonthlyCharges": 75.0,
    "TotalCharges": 5200.0,
}


@pytest.fixture
def customer():
    return copy.deepcopy(VALID_CUSTOMER)


@pytest.fixture
def loyal():
    return copy.deepcopy(LOYAL_CUSTOMER)


@pytest.fixture(scope="session")
def client():
    app = create_app(Settings())
    with TestClient(app) as c:
        yield c


@pytest.fixture
def broken_client(tmp_path):
    app = create_app(Settings(models_dir=tmp_path))
    with TestClient(app) as c:
        yield c
