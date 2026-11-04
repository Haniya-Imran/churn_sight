# Retentra — Customer Churn Predictor

**Explainable AI & Smart Retention Suggestions.** Retentra predicts how likely a customer is to leave, explains *why* with SHAP, and turns the explanation into prioritised, evidence-backed retention actions. It has a 3D landing page and a dashboard, needs no sign-in, and runs fully locally with no paid APIs.

Built by Haniya Imran.

---

## Contents
1. [Features](#features)
2. [Architecture](#architecture)
3. [Project structure](#project-structure)
4. [Quick start](#quick-start)
5. [Dataset](#dataset)
6. [Machine learning](#machine-learning)
7. [SHAP explanations](#shap-explanations)
8. [Retention recommendation engine](#retention-recommendation-engine)
9. [API reference](#api-reference)
10. [Frontend](#frontend)
11. [Testing](#testing)
12. [Configuration](#configuration)
13. [Deployment readiness](#deployment-readiness-not-deployed)
14. [Limitations](#limitations)
15. [Troubleshooting](#troubleshooting)

---

## Features
- **Churn prediction**: probability, predicted class at a documented threshold, and a Low / Medium / High risk band.
- **SHAP explanations**: factors that raise and lower the risk, a waterfall chart, a plain-language summary, and an advanced view with raw log-odds values. The contributions are checked to add up to the model output on every request.
- **Retention suggestions**: only triggered when both the customer's own data and a positive SHAP contribution support them. Each one shows its evidence (model + dataset statistic) and the assumption behind it.
- **Dashboard**: real analytics from all 7,043 customers, churn drivers, risk bands on held-out customers (with their actual churn rates), high- vs low-risk comparison, and a table of at-risk customers that opens any row in Predict.
- **Model page**: test metrics, confusion matrix with false positive / false negative meaning, model comparison, threshold, overfitting check, dataset licence and limitations.
- **Extras**: labelled demo customers (real held-out rows), prediction history for the current tab, downloadable HTML report, JSON export, reset, tooltips, an "inputs changed" warning so results are never stale, reduced-motion support, and a flat fallback when CSS 3D isn't available.

## Architecture
```
Browser (React + Vite)                     FastAPI (Python)
┌──────────────────────────┐   JSON    ┌──────────────────────────────────────┐
│ Landing (CSS 3D scene)   │ ───────▶  │ /predict ─ schemas (validation)       │
│ Dashboard / Predict /    │           │          ─ model_service (pipeline)   │
│ Model pages              │ ◀───────  │          ─ ml.explain (SHAP)          │
│ lib/api.ts (one client)  │           │          ─ explanations + recommend.  │
└──────────────────────────┘           │ /model-info /analytics /samples       │
                                       └───────────────┬──────────────────────┘
                                                       │ loads once at startup
                                          models/*.joblib, *.json (from ml/train.py)
```
`ml/features.py` is the single source of truth for feature names, order, allowed values and input rules. Training, the API schema and (via `/model-info`) the frontend form all read from it.

## Project structure
```
churnsight/
├── backend/app/
│   ├── main.py                 app factory, CORS, body-size limit, error handlers
│   ├── config.py               settings from environment variables
│   ├── schemas.py              request/response models (generated from ml/features.py)
│   ├── api/routes.py           endpoints
│   └── services/
│       ├── model_service.py    artifact loading, prediction, risk bands
│       ├── explanations.py     SHAP → readable explanation
│       └── recommendations.py  retention rules
├── ml/
│   ├── features.py             feature schema, cleaning, input rules
│   ├── explain.py              SHAP explainer (linear + tree models), additivity check
│   ├── train.py                training, comparison, evaluation, artifacts
│   └── download_data.py        dataset download with checksum
├── models/                     trained artifacts (small, committed)
├── data/raw/                   dataset (downloaded, git-ignored)
├── frontend/                   React + TypeScript + Vite app
│   └── src/{pages,components,lib,styles,test}
├── tests/                      pytest (ML + API) and tests/e2e/e2e.cjs (browser)
├── requirements.txt / requirements-dev.txt
├── .env.example  frontend/.env.example  .gitignore
```

## Quick start
Requirements: **Python 3.11–3.13**, **Node.js 18+**.

```bash
# 1. Backend
python -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
python -m ml.download_data           # downloads + verifies the dataset
python -m ml.train                   # optional: artifacts are already in models/
uvicorn backend.app.main:app --reload --port 8000

# 2. Frontend (new terminal)
cd frontend
cp .env.example .env                 # VITE_API_BASE_URL=http://localhost:8000
npm install
npm run dev                          # http://localhost:5173
```
Open http://localhost:5173. API docs are at http://localhost:8000/docs.

Run all commands from the project root unless noted (the backend imports the `ml` package).

## Dataset
| | |
|---|---|
| Name | IBM Telco Customer Churn |
| Source | https://github.com/IBM/telco-customer-churn-on-icp4d (`data/Telco-Customer-Churn.csv`) |
| Licence | Apache License 2.0 (repository licence) |
| Content | 7,043 fictional telecom customers created by IBM as sample data, 21 columns |
| SHA-256 | `16320c9c1ec72448db59aa0a26a0b95401046bef5d02fd3aeb906448e3055e91` |

**Validation and cleaning** (see `ml/features.py`, reported in `models/model_metadata.json`):
- No missing values; no duplicate customer IDs. 22 rows share identical attributes but are different customers, so they are kept.
- `TotalCharges` is text; 11 blanks all have `tenure = 0` (not billed yet), so they are set to 0.
- `SeniorCitizen` is mapped from 0/1 to No/Yes; `Churn` to 0/1. 26.5% of customers churned (moderate imbalance).
- Every row is checked against the API's input rules (e.g. no add-ons without internet); 0 violations.
- **Excluded**: `customerID` (identifier) and `gender` (protected attribute, no legitimate retention action, ~no signal).
- **Leakage review**: no post-churn fields exist. `TotalCharges` is closely tied to tenure × monthly charges but is known at prediction time, so it is kept.

The CSV is git-ignored; `python -m ml.download_data` fetches and verifies it. If downloads are blocked, save the file from the URL above to `data/raw/Telco-Customer-Churn.csv`.

## Machine learning
- 80/20 **stratified** split, `random_state=42`. Preprocessing (scaling + one-hot encoding with fixed categories) lives inside the scikit-learn `Pipeline`, so it is fitted on training data only and reused unchanged at inference.
- **Candidates** compared with 5-fold stratified cross-validation on the training split (out-of-fold metrics):

| Model | ROC-AUC | PR-AUC | F1 | Recall | Precision | Brier |
|---|---|---|---|---|---|---|
| Baseline (predicts class prior) | 0.500 | 0.265 | 0.000 | 0.000 | 0.000 | 0.195 |
| **Logistic Regression (selected)** | 0.846 | 0.659 | 0.639 | 0.744 | 0.560 | 0.135 |
| Random Forest | 0.846 | 0.659 | 0.638 | 0.756 | 0.551 | 0.135 |
| LightGBM | 0.845 | 0.661 | 0.637 | 0.714 | 0.575 | 0.135 |

- **Selection rule**: best CV PR-AUC; among models within 0.005 of it, the simplest and most interpretable wins. All three were effectively tied, so Logistic Regression was chosen.
- **Imbalance**: no resampling or class weights, so probabilities stay calibrated (Brier 0.138 on test). Instead, the **decision threshold is tuned to maximise F1 on out-of-fold training predictions: 0.3275**. It is never tuned on the test set.
- **Held-out test results** (1,409 customers, threshold 0.3275):

| Accuracy | Precision | Recall | F1 | ROC-AUC | PR-AUC | Brier |
|---|---|---|---|---|---|---|
| 0.762 | 0.539 | 0.719 | 0.616 | 0.842 | 0.635 | 0.138 |

  Confusion matrix: TN 805 · FP 230 · FN 105 · TP 269. At the default 0.5 threshold, recall would drop to 0.554 (precision 0.649).
- **False positives (230)**: customers flagged who stayed. Cost: an offer or call spent unnecessarily. **False negatives (105)**: customers who left unflagged. Cost: lost revenue with no chance to act. The lower threshold deliberately trades extra false positives for fewer missed churners.
- **Overfitting check**: train ROC-AUC 0.849 vs test 0.842 (gap 0.007).
- **Risk bands**: Low < 32.75% (predicted to stay) · Medium 32.75–60% · High ≥ 60%. On the test set, 71% of High, 42% of Medium and 12% of Low customers actually churned.

Retrain with `python -m ml.train`. Results are reproducible (fixed seeds).

## SHAP explanations
- `shap.LinearExplainer` with an interventional (independent) masker over 200 training customers, in **log-odds** space. `ml/explain.py` also supports `TreeExplainer` for LightGBM / forests, so the code still works if the selected model changes.
- SHAP values are computed on the transformed columns and **summed back to the 18 business features** (valid because SHAP is additive).
- **Verification on every call**: `base_value + Σ contributions` must equal the model's log-odds output (tolerance 1e-3). Otherwise the API returns an error (`explanation_failed`) instead of numbers.
- Each factor also gets an approximate "percentage points" impact, `p(x) − sigmoid(logit(p) − φᵢ)`, for non-technical readers.
- SHAP describes how the model uses its inputs, **not causation**. Correlated inputs (tenure and total charges) can share or offset credit.

## Retention recommendation engine
`backend/app/services/recommendations.py`. A rule fires only when **(1)** the customer's input has the relevant fact and **(2)** that feature's SHAP contribution is positive. Rules cover: longer contract, early-life onboarding (tenure ≤ 12), fiber service review, tech support, online security, protection bundle, automatic payment, and pricing review (only if the bill is above the dataset average).
- **Priority** comes from the factor's impact (≥ 8 pts High, ≥ 3 Medium, otherwise Low). For Low-risk customers, driver actions are shown as optional.
- An **outreach** item is always listed first, based on the risk band (proactive contact / watch-list / maintain).
- Each suggestion has **evidence** (the model contribution plus a dataset churn rate) and an **assumption**, and is never presented as a guarantee. No LLM is used, so everything works offline.

## API reference
| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | `{"status":"ok","model_loaded":true,...}`; returns 503 if artifacts are missing |
| GET | `/model-info` | metrics, comparison, threshold, bands, feature schema, limitations |
| POST | `/predict` | validate input → prediction + SHAP explanation + recommendations |
| GET | `/analytics/overview` | dashboard statistics |
| GET | `/samples` | labelled demo customers (real held-out rows) |

**Request** (`POST /predict`). All 18 fields are required and unknown fields are rejected:
```json
{"SeniorCitizen":"No","Partner":"Yes","Dependents":"No","tenure":1,
 "PhoneService":"No","MultipleLines":"No phone service","InternetService":"DSL",
 "OnlineSecurity":"No","OnlineBackup":"Yes","DeviceProtection":"No","TechSupport":"No",
 "StreamingTV":"No","StreamingMovies":"No","Contract":"Month-to-month",
 "PaperlessBilling":"Yes","PaymentMethod":"Electronic check",
 "MonthlyCharges":29.85,"TotalCharges":29.85}
```
**Response** (abridged, real output for the request above):
```json
{"prediction":{"probability":0.6085,"will_churn":true,"label":"Likely to churn","risk_band":"High","threshold":0.3275,"high_risk_cutoff":0.6},
 "explanation":{"base_value":-1.386,"model_output":0.4413,"summary":"The model estimates a 61% chance ...",
   "top_increasing":[{"feature":"tenure","label":"Tenure","value":1,"shap_value":1.41196,"direction":"increases_risk","impact_pct_points":33.38}, "..."],
   "top_decreasing":["..."],"contributions":["... all 18 ..."],"note":"SHAP shows how much ..."},
 "recommendations":[{"id":"proactive-contact","priority":"High","title":"Contact this customer proactively","evidence":["..."],"assumption":"..."}, "..."],
 "model":{"name":"Logistic Regression","version":"1.0.0"},"generated_at":"..."}
```
**Errors** are JSON `{"error","message","details?"}`: 422 invalid input (with per-field details, including business rules such as add-ons without internet), 413 body over 16 KB, 503 model unavailable, 500 explanation failed / internal error (no stack traces).

## Frontend
React 18 + TypeScript + Vite, react-router, lucide icons, and self-hosted Sora/Manrope fonts. The visual direction follows the supplied **3D.jpg** reference and the approved Dashboard/Predict designs: a mid-tone grey-blue background, frosted glass panels, navy screens, blue accents, and orange reserved for risk.
- **3D**: the landing scene, podium, 3D pie and risk orb are real CSS 3D (`preserve-3d`, stacked layers). You can drag to rotate and they spring back on release. There is no WebGL dependency, so the bundle stays light (≈75 KB gzipped JS). They stay still under `prefers-reduced-motion` and fall back to a flat layout without 3D support.
- **Charts** are hand-built SVG/HTML with text alternatives.
- **API access** goes only through `src/lib/api.ts`: base URL from `VITE_API_BASE_URL`, timeout, typed errors, response validation, and abort of superseded requests.
- **Accessibility**: semantic landmarks, labelled fields with `aria-invalid`/`aria-describedby`, keyboard tooltips, visible focus rings, a skip link, and an error summary with focus moved to the first invalid field.

## Testing
```bash
# Backend + ML (35 tests): data, pipeline, SHAP additivity, API, errors, CORS, limits
python -m pytest

# Frontend (33 tests): form rules, API client, pages (Vitest + Testing Library)
cd frontend && npm test && npm run typecheck

# End-to-end in a real browser against the running backend + frontend (17 checks)
npm i -g playwright && npx playwright install chromium
node tests/e2e/e2e.cjs            # E2E_APP_URL / E2E_API_URL to override
```
Latest run: **35/35 pytest, 33/33 Vitest, 17/17 E2E** on the dev server and on the production build (`vite preview`), with no browser console errors or warnings and no backend errors in the logs.

## Configuration
Backend (`.env` at the project root, prefix `CHURNSIGHT_`, see `.env.example`): `APP_ENV`, `MODELS_DIR`, `CORS_ORIGINS` (explicit list, no wildcard), `MAX_BODY_BYTES`, `LOG_LEVEL`.
Frontend (`frontend/.env`): `VITE_API_BASE_URL`, `VITE_API_TIMEOUT_MS`. No secrets or API keys are needed.

## Deployment readiness (not deployed)
- **Backend start**: `uvicorn backend.app.main:app --host 0.0.0.0 --port $PORT` from the project root. Artifacts in `models/` are loaded once at startup.
- **Frontend build**: `cd frontend && npm ci && npm run build` → static `frontend/dist/`. Set `VITE_API_BASE_URL` at build time. Without it, a production build calls the API on the same origin. Configure an SPA rewrite (all routes → `index.html`).
- Set `CHURNSIGHT_CORS_ORIGINS` to the deployed frontend URL.
- Keep the pinned `scikit-learn` version: joblib artifacts must load with the version they were trained with (otherwise retrain).
- SHAP pulls in `numba`/`llvmlite`, which adds memory use and cold-start time. Check the limits of small free hosting tiers.

## Limitations
- The model is trained on IBM's **fictional** sample data. A real business must retrain on its own data before relying on it.
- Probabilities are estimates from historical correlations. Precision is 54% at the chosen threshold, so about half of flagged customers would have stayed.
- SHAP explains the model, not causes. Correlated features can share or offset credit.
- The model doesn't see complaints, usage, service quality, competitor offers or customer feedback.
- Recommendations are rule-based starting points. Their effect on churn isn't measured in this data.
- History lives only in the current browser tab (sessionStorage). Nothing is stored server-side.

## Troubleshooting
| Problem | Fix |
|---|---|
| UI says "Can't reach the Retentra server" | Start the backend on port 8000, check `VITE_API_BASE_URL`, and restart `npm run dev` after editing `.env` |
| Browser CORS error | Add your frontend origin to `CHURNSIGHT_CORS_ORIGINS` |
| `/health` returns 503 / "Missing model artifacts" | Run `python -m ml.download_data && python -m ml.train` |
| `ModuleNotFoundError: ml` | Run uvicorn/pytest from the project root |
| Warning or error when loading the model after upgrading scikit-learn | Reinstall `requirements.txt` or retrain |
| Dataset download blocked | Download the CSV manually from the dataset URL into `data/raw/` |
