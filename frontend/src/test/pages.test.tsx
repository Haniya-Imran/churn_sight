import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import analytics from "./fixtures/analytics.json";
import modelInfo from "./fixtures/model-info.json";
import predict from "./fixtures/predict-high.json";
import samples from "./fixtures/samples.json";
import { ApiError, api } from "../lib/api";
import App from "../App";

vi.mock("../lib/api", async (orig) => {
  const actual = await orig<typeof import("../lib/api")>();
  return {
    ...actual,
    api: {
      health: vi.fn(),
      modelInfo: vi.fn(),
      analytics: vi.fn(),
      samples: vi.fn(),
      predict: vi.fn(),
    },
  };
});

const mocked = api as unknown as Record<keyof typeof api, ReturnType<typeof vi.fn>>;

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/*" element={<App />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  sessionStorage.clear();
  mocked.modelInfo.mockResolvedValue(modelInfo);
  mocked.analytics.mockResolvedValue(analytics);
  mocked.samples.mockResolvedValue(samples);
  mocked.predict.mockResolvedValue(predict);
});

afterEach(() => vi.clearAllMocks());

describe("landing page", () => {
  it("shows the value proposition, CTA and real metrics", async () => {
    renderAt("/");
    expect(screen.getByRole("heading", { level: 1, name: /know which customers will leave/i })).toBeInTheDocument();
    const cta = screen.getAllByRole("link", { name: /get started/i })[0];
    expect(cta).toHaveAttribute("href", "/predict");
    expect(await screen.findAllByText(analytics.test_metrics.roc_auc.toFixed(3))).not.toHaveLength(0);
  });

  it("navigates to the app without any sign-in", async () => {
    renderAt("/");
    await userEvent.click(screen.getAllByRole("link", { name: /get started/i })[0]);
    expect(await screen.findByRole("heading", { name: /predict a customer/i })).toBeInTheDocument();
    expect(screen.queryByText(/sign in|log in|password/i)).toBeNull();
  });
});

describe("predict page", () => {
  it("validates required fields before calling the API", async () => {
    renderAt("/predict");
    const btn = await screen.findByRole("button", { name: /predict churn/i });
    await userEvent.click(btn);
    expect(await screen.findByText(/please fix 3 fields/i)).toBeInTheDocument();
    expect(mocked.predict).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^tenure/i)).toHaveAttribute("aria-invalid", "true");
  });

  it("submits the form and renders the real response", async () => {
    renderAt("/predict");
    await userEvent.type(await screen.findByLabelText(/^tenure/i), "1");
    await userEvent.type(screen.getByLabelText(/^monthly charges/i), "95.1");
    await userEvent.type(screen.getByLabelText(/^total charges/i), "95.1");
    await userEvent.click(screen.getByRole("button", { name: /predict churn/i }));
    await waitFor(() => expect(mocked.predict).toHaveBeenCalledTimes(1));
    const payload = mocked.predict.mock.calls[0][0];
    expect(payload).toMatchObject({ tenure: 1, MonthlyCharges: 95.1, TotalCharges: 95.1, Contract: "Month-to-month" });
    expect(Object.keys(payload).sort()).toEqual([...modelInfo.features.order].sort());

    expect(await screen.findByText("SHAP explanation")).toBeInTheDocument();
    expect(screen.getByText(predict.explanation.summary)).toBeInTheDocument();
    for (const r of predict.recommendations) expect(screen.getByRole("heading", { name: r.title })).toBeInTheDocument();
    const hist = screen.getByRole("region", { name: /this session's predictions/i });
    expect(within(hist).getByText("85%")).toBeInTheDocument();
  });

  it("runs a labelled demo customer and supports reset", async () => {
    renderAt("/predict");
    await userEvent.click(await screen.findByRole("button", { name: "High-risk example" }));
    await waitFor(() => expect(mocked.predict).toHaveBeenCalledWith(samples.samples[0].features, expect.anything()));
    expect(screen.getByText(/demonstration data/i)).toBeInTheDocument();
    expect(await screen.findByText("SHAP explanation")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^reset$/i }));
    expect(screen.queryByText("SHAP explanation")).toBeNull();
    expect(screen.getByLabelText(/^tenure/i)).toHaveValue(null);
  });

  it("marks results as outdated when inputs change", async () => {
    renderAt("/predict");
    await userEvent.click(await screen.findByRole("button", { name: "High-risk example" }));
    await screen.findByText("SHAP explanation");
    await userEvent.selectOptions(screen.getByLabelText(/^contract/i), "Two year");
    expect(screen.getByText(/inputs changed since this result/i)).toBeInTheDocument();
  });

  it("prevents duplicate submissions while a request is running", async () => {
    let resolve!: (v: unknown) => void;
    mocked.predict.mockImplementation(() => new Promise((r) => (resolve = r)));
    renderAt("/predict");
    await userEvent.click(await screen.findByRole("button", { name: "High-risk example" }));
    const busy = await screen.findByRole("button", { name: /predicting/i });
    expect(busy).toBeDisabled();
    await userEvent.click(busy);
    expect(mocked.predict).toHaveBeenCalledTimes(1);
    resolve(predict);
    expect(await screen.findByText("SHAP explanation")).toBeInTheDocument();
  });

  it("shows a clear error when the backend is unreachable", async () => {
    mocked.predict.mockRejectedValue(new ApiError("network", "Can't reach the Retentra server. Check that the backend is running and try again."));
    renderAt("/predict");
    await userEvent.click(await screen.findByRole("button", { name: "High-risk example" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/can't reach the retentra server/i);
    expect(screen.queryByText("SHAP explanation")).toBeNull();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("shows server-side validation messages on the right field", async () => {
    mocked.predict.mockRejectedValue(new ApiError("validation", "Some customer details are missing or invalid.", 422, [{ field: "tenure", message: "Input should be less than or equal to 120" }]));
    renderAt("/predict");
    await userEvent.click(await screen.findByRole("button", { name: "High-risk example" }));
    expect(await screen.findByText("Input should be less than or equal to 120")).toBeInTheDocument();
  });

  it("shows an error state if the model is unavailable", async () => {
    mocked.modelInfo.mockRejectedValue(new ApiError("unavailable", "Missing model artifacts", 503));
    renderAt("/predict");
    expect(await screen.findByText(/prediction service isn't available/i)).toBeInTheDocument();
  });
});

describe("dashboard", () => {
  it("renders real analytics and opens a customer in Predict", async () => {
    renderAt("/dashboard");
    expect(await screen.findByText("26.5%")).toBeInTheDocument();
    const top = analytics.top_risk_customers[0];
    await userEvent.click(screen.getByRole("button", { name: `Analyse customer ${top.customer_id}` }));
    await waitFor(() => expect(mocked.predict).toHaveBeenCalledWith(top.features, expect.anything()));
    expect((await screen.findAllByText(`#${top.customer_id}`)).length).toBeGreaterThan(0);
  });

  it("pages through at-risk customers", async () => {
    renderAt("/dashboard");
    const more = await screen.findByRole("button", { name: /show more/i });
    const before = screen.getAllByRole("button", { name: /^analyse customer/i }).length;
    await userEvent.click(more);
    expect(screen.getAllByRole("button", { name: /^analyse customer/i }).length).toBeGreaterThan(before);
  });
});

describe("model page", () => {
  it("shows metrics, confusion matrix and limitations", async () => {
    renderAt("/model");
    expect(await screen.findByText(/confusion matrix/i)).toBeInTheDocument();
    expect(screen.getByText(String(modelInfo.test_metrics.confusion_matrix.tp))).toBeInTheDocument();
    expect(screen.getByText(modelInfo.limitations[0])).toBeInTheDocument();
  });
});
