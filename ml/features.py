"""Single source of truth for the model's input features.

The training script, the FastAPI backend and (through /model-info) the frontend
form all read from this module, so field names, allowed values and order can
never drift apart.
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd

TARGET = "Churn"
ID_COLUMN = "customerID"

# `gender` is deliberately excluded: it is a protected attribute, it offers no
# legitimate retention action, and in this dataset it carries ~no signal.
EXCLUDED_COLUMNS = ["gender"]

NUMERIC_FEATURES: dict[str, dict] = {
    "tenure": {
        "label": "Tenure",
        "unit": "months",
        "help": "How many months the customer has been with the company.",
        "min": 0,
        "max": 120,
        "step": 1,
        "integer": True,
    },
    "MonthlyCharges": {
        "label": "Monthly charges",
        "unit": "USD",
        "help": "The amount the customer is billed each month.",
        "min": 0,
        "max": 500,
        "step": 0.01,
        "integer": False,
    },
    "TotalCharges": {
        "label": "Total charges to date",
        "unit": "USD",
        "help": "Everything billed so far. Usually close to tenure × monthly charges.",
        "min": 0,
        "max": 60000,
        "step": 0.01,
        "integer": False,
    },
}

YES_NO = ["No", "Yes"]
INTERNET_ADDON = ["No", "Yes", "No internet service"]

CATEGORICAL_FEATURES: dict[str, dict] = {
    "SeniorCitizen": {"label": "Senior citizen", "help": "Customer is 65 or older.", "options": YES_NO},
    "Partner": {"label": "Has a partner", "help": "Customer has a spouse or partner.", "options": YES_NO},
    "Dependents": {"label": "Has dependents", "help": "Customer has children or other dependents.", "options": YES_NO},
    "PhoneService": {"label": "Phone service", "help": "Subscribes to home phone service.", "options": YES_NO},
    "MultipleLines": {
        "label": "Multiple phone lines",
        "help": "Has more than one phone line.",
        "options": ["No", "Yes", "No phone service"],
    },
    "InternetService": {
        "label": "Internet service",
        "help": "Type of internet connection.",
        "options": ["DSL", "Fiber optic", "No"],
    },
    "OnlineSecurity": {"label": "Online security", "help": "Online security add-on.", "options": INTERNET_ADDON},
    "OnlineBackup": {"label": "Online backup", "help": "Online backup add-on.", "options": INTERNET_ADDON},
    "DeviceProtection": {"label": "Device protection", "help": "Device protection plan.", "options": INTERNET_ADDON},
    "TechSupport": {"label": "Tech support", "help": "Premium technical support add-on.", "options": INTERNET_ADDON},
    "StreamingTV": {"label": "Streaming TV", "help": "Streams TV through the internet service.", "options": INTERNET_ADDON},
    "StreamingMovies": {"label": "Streaming movies", "help": "Streams movies through the internet service.", "options": INTERNET_ADDON},
    "Contract": {
        "label": "Contract",
        "help": "Length of the customer's current contract.",
        "options": ["Month-to-month", "One year", "Two year"],
    },
    "PaperlessBilling": {"label": "Paperless billing", "help": "Receives bills electronically.", "options": YES_NO},
    "PaymentMethod": {
        "label": "Payment method",
        "help": "How the customer pays.",
        "options": [
            "Electronic check",
            "Mailed check",
            "Bank transfer (automatic)",
            "Credit card (automatic)",
        ],
    },
}

INTERNET_DEPENDENT = [
    "OnlineSecurity",
    "OnlineBackup",
    "DeviceProtection",
    "TechSupport",
    "StreamingTV",
    "StreamingMovies",
]

FEATURE_ORDER: list[str] = [
    "SeniorCitizen",
    "Partner",
    "Dependents",
    "tenure",
    "PhoneService",
    "MultipleLines",
    "InternetService",
    "OnlineSecurity",
    "OnlineBackup",
    "DeviceProtection",
    "TechSupport",
    "StreamingTV",
    "StreamingMovies",
    "Contract",
    "PaperlessBilling",
    "PaymentMethod",
    "MonthlyCharges",
    "TotalCharges",
]

FEATURE_LABELS = {**{k: v["label"] for k, v in NUMERIC_FEATURES.items()},
                  **{k: v["label"] for k, v in CATEGORICAL_FEATURES.items()}}

assert set(FEATURE_ORDER) == set(NUMERIC_FEATURES) | set(CATEGORICAL_FEATURES)


def load_raw(path: str | Path) -> pd.DataFrame:
    """Read the IBM Telco CSV and check that the expected schema is present."""
    df = pd.read_csv(path)
    expected = set(FEATURE_ORDER) | {TARGET, ID_COLUMN} | set(EXCLUDED_COLUMNS)
    missing = expected - set(df.columns)
    if missing:
        raise ValueError(f"Dataset is missing expected columns: {sorted(missing)}")
    return df


def clean(df: pd.DataFrame) -> pd.DataFrame:
    """Apply the dataset-level cleaning used for training and analytics.

    * TotalCharges arrives as text; 11 rows are blank and all have tenure == 0
      (brand-new customers not yet billed), so they are set to 0.
    * SeniorCitizen is stored as 0/1; it is mapped to No/Yes so that it is
      treated like the other binary categorical inputs.
    * Churn is mapped to 0/1.
    """
    out = df.copy()
    out["TotalCharges"] = pd.to_numeric(out["TotalCharges"], errors="coerce")
    blank = out["TotalCharges"].isna()
    if not (out.loc[blank, "tenure"] == 0).all():
        raise ValueError("Unexpected blank TotalCharges for customers with tenure > 0")
    out.loc[blank, "TotalCharges"] = 0.0
    out["SeniorCitizen"] = out["SeniorCitizen"].map({0: "No", 1: "Yes"})
    out[TARGET] = out[TARGET].map({"No": 0, "Yes": 1}).astype(int)
    for col, spec in CATEGORICAL_FEATURES.items():
        bad = set(out[col].astype(str).unique()) - set(spec["options"])
        if bad:
            raise ValueError(f"Column {col} has unexpected values: {sorted(bad)}")
    return out


def to_frame(records: list[dict]) -> pd.DataFrame:
    """Turn validated input dicts into a DataFrame with the exact training column order."""
    frame = pd.DataFrame.from_records(records)
    frame = frame[FEATURE_ORDER]
    for col in NUMERIC_FEATURES:
        frame[col] = frame[col].astype(float)
    for col in CATEGORICAL_FEATURES:
        frame[col] = frame[col].astype(str)
    return frame


def consistency_errors(record: dict) -> list[str]:
    """Business-rule checks that mirror how the dataset was recorded."""
    errors: list[str] = []
    if record.get("InternetService") == "No":
        for col in INTERNET_DEPENDENT:
            if record.get(col) != "No internet service":
                errors.append(f"{col} must be 'No internet service' when InternetService is 'No'.")
    else:
        for col in INTERNET_DEPENDENT:
            if record.get(col) == "No internet service":
                errors.append(f"{col} cannot be 'No internet service' when the customer has internet service.")
    if record.get("PhoneService") == "No" and record.get("MultipleLines") != "No phone service":
        errors.append("MultipleLines must be 'No phone service' when PhoneService is 'No'.")
    if record.get("PhoneService") == "Yes" and record.get("MultipleLines") == "No phone service":
        errors.append("MultipleLines cannot be 'No phone service' when PhoneService is 'Yes'.")
    tenure = record.get("tenure")
    total = record.get("TotalCharges")
    monthly = record.get("MonthlyCharges")
    if tenure == 0 and total not in (None, 0, 0.0):
        errors.append("TotalCharges must be 0 for a customer with 0 months of tenure.")
    if isinstance(tenure, (int, float)) and isinstance(total, (int, float)) and isinstance(monthly, (int, float)):
        # Allow generous slack for price changes over time, but reject impossible values.
        if tenure > 0 and total > monthly * tenure * 3 + 100:
            errors.append("TotalCharges is far higher than tenure × monthly charges allows.")
    return errors
