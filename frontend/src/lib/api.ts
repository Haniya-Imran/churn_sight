import { API_BASE_URL, API_TIMEOUT_MS } from "./config";
import type { Analytics, CustomerInput, ModelInfo, PredictResponse, SamplesResponse } from "./types";

export type ApiErrorKind = "network" | "timeout" | "validation" | "unavailable" | "server" | "invalid_response" | "aborted";

export class ApiError extends Error {
  kind: ApiErrorKind;
  status?: number;
  details?: { field: string | null; message: string }[];

  constructor(kind: ApiErrorKind, message: string, status?: number, details?: ApiError["details"]) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.details = details;
  }
}

type Validator<T> = (data: unknown) => data is T;

async function request<T>(path: string, validate: Validator<T>, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, API_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
    });
  } catch {
    if (timedOut) throw new ApiError("timeout", "The server took too long to respond. Please try again.");
    if (signal?.aborted) throw new ApiError("aborted", "Request cancelled.");
    throw new ApiError("network", "Can't reach the ChurnSight server. Check that the backend is running and try again.");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const b = (body ?? {}) as { message?: string; details?: ApiError["details"] };
    const message = typeof b.message === "string" ? b.message : `Request failed (${response.status}).`;
    if (response.status === 422) throw new ApiError("validation", message, 422, b.details);
    if (response.status === 503) throw new ApiError("unavailable", message, 503);
    throw new ApiError("server", message, response.status);
  }
  if (!validate(body)) {
    throw new ApiError("invalid_response", "The server sent an unexpected response, so no result is shown.");
  }
  return body;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

export const isPredictResponse = (d: unknown): d is PredictResponse => {
  if (!isObj(d) || !isObj(d.prediction) || !isObj(d.explanation) || !Array.isArray(d.recommendations)) return false;
  const p = d.prediction;
  const e = d.explanation;
  return (
    typeof p.probability === "number" &&
    p.probability >= 0 &&
    p.probability <= 1 &&
    ["Low", "Medium", "High"].includes(p.risk_band as string) &&
    Array.isArray(e.contributions) &&
    e.contributions.length > 0 &&
    typeof e.base_value === "number"
  );
};

const isModelInfo = (d: unknown): d is ModelInfo => isObj(d) && typeof d.model_name === "string" && isObj(d.features);
const isAnalytics = (d: unknown): d is Analytics => isObj(d) && isObj(d.totals) && Array.isArray(d.top_risk_customers);
const isSamples = (d: unknown): d is SamplesResponse => isObj(d) && Array.isArray(d.samples);
const isHealth = (d: unknown): d is { status: string; model_loaded: boolean } => isObj(d) && typeof d.status === "string";

export const api = {
  health: (signal?: AbortSignal) => request("/health", isHealth, {}, signal),
  modelInfo: (signal?: AbortSignal) => request("/model-info", isModelInfo, {}, signal),
  analytics: (signal?: AbortSignal) => request("/analytics/overview", isAnalytics, {}, signal),
  samples: (signal?: AbortSignal) => request("/samples", isSamples, {}, signal),
  predict: (customer: CustomerInput, signal?: AbortSignal) =>
    request("/predict", isPredictResponse, { method: "POST", body: JSON.stringify(customer) }, signal),
};
