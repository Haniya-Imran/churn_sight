"""Retention recommendation engine.

Every recommendation is triggered by two things together:
1. a fact present in the customer's own input, and
2. a positive SHAP contribution for that input (the model says it raises risk).

Each one carries the evidence (model contribution + dataset statistic) and the
assumption it rests on, so users can tell what is measured and what is judgement.
No recommendation is presented as a guarantee.
"""
from __future__ import annotations

from collections.abc import Callable

from .explanations import format_value

Rule = Callable[[dict, dict, dict], dict | None]


def _pct(x: float) -> str:
    return f"{x * 100:.1f}%"


def _rate(analytics: dict, feature: str, group: str) -> float | None:
    for row in analytics.get("churn_rate_by_feature", {}).get(feature, []):
        if row["group"] == group:
            return row["churn_rate"]
    return None


def _priority(impact: float) -> str:
    if impact >= 8:
        return "High"
    if impact >= 3:
        return "Medium"
    return "Low"


def _model_evidence(c: dict) -> str:
    return (
        f"Model: {c['label']} = {format_value(c['feature'], c['value'])} raises this customer's churn "
        f"probability by about {c['impact_pct_points']:.1f} percentage points (SHAP)."
    )


def _rising(contribs: dict, feature: str) -> dict | None:
    c = contribs.get(feature)
    return c if c and c["shap_value"] > 0 else None


def rule_contract(customer, contribs, analytics):
    c = _rising(contribs, "Contract")
    if customer["Contract"] != "Month-to-month" or not c:
        return None
    m, o, t = (_rate(analytics, "Contract", g) for g in ("Month-to-month", "One year", "Two year"))
    return {
        "id": "contract-upgrade",
        "title": "Offer a longer contract with a clear benefit",
        "action": "Propose a one- or two-year plan with a tangible incentive such as a price lock or loyalty discount.",
        "why": "The month-to-month contract is one of the strongest reasons the model rates this customer as at risk.",
        "evidence": [
            _model_evidence(c),
            f"Dataset: month-to-month customers churned at {_pct(m)}, versus {_pct(o)} on one-year and {_pct(t)} on two-year contracts.",
        ],
        "assumption": "Assumes the customer is open to a longer commitment; the dataset does not show how customers react to offers.",
        "drivers": ["Contract"],
        "_impact": c["impact_pct_points"],
    }


def rule_tenure(customer, contribs, analytics):
    c = _rising(contribs, "tenure")
    if customer["tenure"] > 12 or not c:
        return None
    bands = {r["group"]: r["churn_rate"] for r in analytics.get("churn_by_tenure_band", [])}
    band = "0–6" if customer["tenure"] <= 6 else "7–12"
    return {
        "id": "early-life",
        "title": "Strengthen early-life onboarding",
        "action": "Schedule a welcome check-in, confirm the service is set up correctly and make sure the first bills are understood.",
        "why": f"The customer joined recently ({format_value('tenure', customer['tenure'])}), and short tenure strongly raises predicted risk.",
        "evidence": [
            _model_evidence(c),
            f"Dataset: customers in their first {band} months churned at {_pct(bands.get(band, 0))}, versus {_pct(bands.get('61–72', 0))} for customers with 61–72 months.",
        ],
        "assumption": "Assumes early contact improves the experience; the data shows the pattern, not the effect of onboarding.",
        "drivers": ["tenure"],
        "_impact": c["impact_pct_points"],
    }


def rule_fiber(customer, contribs, analytics):
    c = _rising(contribs, "InternetService")
    if customer["InternetService"] != "Fiber optic" or not c:
        return None
    fib, dsl = _rate(analytics, "InternetService", "Fiber optic"), _rate(analytics, "InternetService", "DSL")
    return {
        "id": "fiber-experience",
        "title": "Investigate the fiber service experience",
        "action": "Review this customer's service quality and price against current fiber plans, and ask about any issues.",
        "why": "Fiber optic internet raises this customer's predicted risk.",
        "evidence": [
            _model_evidence(c),
            f"Dataset: fiber optic customers churned at {_pct(fib)}, versus {_pct(dsl)} for DSL customers.",
        ],
        "assumption": "The dataset does not record why fiber customers leave (price, reliability or competition); confirm with the customer before acting.",
        "drivers": ["InternetService"],
        "_impact": c["impact_pct_points"],
    }


def _addon_rule(feature: str, rid: str, title: str, action: str, name: str) -> Rule:
    def rule(customer, contribs, analytics):
        c = _rising(contribs, feature)
        if customer[feature] != "No" or not c:
            return None
        no, yes = _rate(analytics, feature, "No"), _rate(analytics, feature, "Yes")
        return {
            "id": rid,
            "title": title,
            "action": action,
            "why": f"Not having {name} raises this customer's predicted risk.",
            "evidence": [
                _model_evidence(c),
                f"Dataset: internet customers without {name} churned at {_pct(no)}, versus {_pct(yes)} for those with it.",
            ],
            "assumption": f"Customers who choose {name} may differ in other ways, so adding it may not by itself reduce churn.",
            "drivers": [feature],
            "_impact": c["impact_pct_points"],
        }

    return rule


rule_tech_support = _addon_rule(
    "TechSupport",
    "tech-support",
    "Improve support follow-up",
    "Offer a free trial of tech support or a proactive support call to resolve open issues.",
    "tech support",
)
rule_security = _addon_rule(
    "OnlineSecurity",
    "online-security",
    "Offer the online security add-on",
    "Offer a discounted or trial online security package and explain what it protects.",
    "online security",
)


def rule_protection(customer, contribs, analytics):
    rising = [_rising(contribs, f) for f in ("OnlineBackup", "DeviceProtection")]
    rising = [c for c, f in zip(rising, ("OnlineBackup", "DeviceProtection")) if c and customer[f] == "No"]
    if not rising:
        return None
    names = " and ".join(c["label"].lower() for c in rising)
    return {
        "id": "protection-bundle",
        "title": "Suggest a protection bundle",
        "action": f"Offer {names} as a bundled, low-cost add-on to increase the value of the service.",
        "why": f"Not having {names} raises this customer's predicted risk.",
        "evidence": [_model_evidence(c) for c in rising],
        "assumption": "Assumes extra services increase perceived value; uptake and its effect on churn are not measured in the data.",
        "drivers": [c["feature"] for c in rising],
        "_impact": sum(c["impact_pct_points"] for c in rising),
    }


def rule_payment(customer, contribs, analytics):
    c = _rising(contribs, "PaymentMethod")
    if customer["PaymentMethod"] != "Electronic check" or not c:
        return None
    ec = _rate(analytics, "PaymentMethod", "Electronic check")
    auto = _rate(analytics, "PaymentMethod", "Credit card (automatic)")
    return {
        "id": "auto-pay",
        "title": "Encourage automatic payment",
        "action": "Invite the customer to switch to automatic bank transfer or credit card payment, for example with a small one-time credit.",
        "why": "Paying by electronic check raises this customer's predicted risk.",
        "evidence": [
            _model_evidence(c),
            f"Dataset: electronic-check payers churned at {_pct(ec)}, versus {_pct(auto)} for automatic credit-card payers.",
        ],
        "assumption": "Payment method may reflect other habits; switching it alone may not change the customer's decision.",
        "drivers": ["PaymentMethod"],
        "_impact": c["impact_pct_points"],
    }


def rule_price(customer, contribs, analytics):
    c = _rising(contribs, "MonthlyCharges")
    avg = analytics.get("totals", {}).get("avg_monthly_charges")
    # Correlated inputs can give a below-average bill a positive SHAP value; a
    # pricing review only makes business sense when the bill is actually high.
    if not c or avg is None or customer["MonthlyCharges"] <= avg:
        return None
    return {
        "id": "pricing-review",
        "title": "Review plan fit and pricing",
        "action": "Check whether a better-fitting plan or bundle could lower the monthly bill without losing services the customer uses.",
        "why": "The customer's monthly charges raise the predicted risk.",
        "evidence": [
            _model_evidence(c),
            f"Dataset: this customer pays {format_value('MonthlyCharges', customer['MonthlyCharges'])} a month; the average across all customers is {format_value('MonthlyCharges', avg)}.",
        ],
        "assumption": "Price sensitivity is inferred from the model, not confirmed by the customer.",
        "drivers": ["MonthlyCharges"],
        "_impact": c["impact_pct_points"],
    }


DRIVER_RULES: list[Rule] = [
    rule_contract,
    rule_tenure,
    rule_fiber,
    rule_tech_support,
    rule_security,
    rule_protection,
    rule_payment,
    rule_price,
]

_ORDER = {"High": 0, "Medium": 1, "Low": 2}


def outreach(prediction: dict) -> dict:
    p = prediction["probability"] * 100
    band = prediction["risk_band"]
    evidence = [f"Model: estimated churn probability is {p:.0f}% ({band} risk)."]
    if band == "High":
        return {
            "id": "proactive-contact",
            "title": "Contact this customer proactively",
            "priority": "High",
            "action": "Have a retention specialist reach out soon to understand concerns before the customer decides to leave.",
            "why": f"The predicted probability is at or above the {prediction['high_risk_cutoff'] * 100:.0f}% high-risk cut-off.",
            "evidence": evidence,
            "assumption": "Assumes outreach is welcome; respect the customer's contact preferences.",
            "drivers": [],
        }
    if band == "Medium":
        return {
            "id": "watchlist",
            "title": "Add to the retention watch-list",
            "priority": "Medium",
            "action": "Schedule a friendly check-in and monitor for signals such as support complaints or plan downgrades.",
            "why": f"The probability is above the {prediction['threshold'] * 100:.0f}% decision threshold, so the model predicts churn.",
            "evidence": evidence,
            "assumption": "Medium-risk customers often stay; keep the approach light and helpful.",
            "drivers": [],
        }
    return {
        "id": "maintain",
        "title": "Maintain standard engagement",
        "priority": "Low",
        "action": "No urgent retention action is needed; keep regular service communication and consider loyalty recognition.",
        "why": f"The probability is below the {prediction['threshold'] * 100:.0f}% decision threshold.",
        "evidence": evidence,
        "assumption": "A low score is not a guarantee; circumstances outside the data can change.",
        "drivers": [],
    }


def recommend(customer: dict, prediction: dict, explanation: dict, analytics: dict) -> list[dict]:
    contribs = {c["feature"]: c for c in explanation["contributions"]}
    recs = []
    for rule in DRIVER_RULES:
        rec = rule(customer, contribs, analytics)
        if rec:
            impact = rec.pop("_impact")
            rec["priority"] = _priority(impact)
            recs.append((impact, rec))
    recs.sort(key=lambda pair: (_ORDER[pair[1]["priority"]], -pair[0]))
    ordered = [outreach(prediction)] + [r for _, r in recs]
    if prediction["risk_band"] == "Low":
        # For low-risk customers, show driver actions as optional improvements.
        for r in ordered[1:]:
            r["priority"] = "Low"
    return ordered
