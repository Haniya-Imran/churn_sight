import predict from "./fixtures/predict-high.json";
import samples from "./fixtures/samples.json";
import { ApiError, api, isPredictResponse } from "../lib/api";
import type { CustomerInput } from "../lib/types";

const customer = samples.samples[0].features as unknown as CustomerInput;

function mockFetch(impl: (...args: unknown[]) => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("api client", () => {
  it("posts the customer to /predict and returns the validated response", async () => {
    const fetch = mockFetch(() => json(200, predict));
    const res = await api.predict(customer);
    expect(res.prediction.probability).toBe(predict.prediction.probability);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/predict$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(customer);
  });

  it("maps 422 responses to validation errors with field details", async () => {
    mockFetch(() => json(422, { error: "invalid_input", message: "Some customer details are missing or invalid.", details: [{ field: "tenure", message: "bad" }] }));
    await expect(api.predict(customer)).rejects.toMatchObject({ kind: "validation", status: 422, details: [{ field: "tenure", message: "bad" }] });
  });

  it("maps 503 to an unavailable error", async () => {
    mockFetch(() => json(503, { error: "model_unavailable", message: "Missing model artifacts" }));
    await expect(api.predict(customer)).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("reports network failures clearly", async () => {
    mockFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    const err = await api.health().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.kind).toBe("network");
    expect(err.message).toMatch(/reach the Retentra server/);
  });

  it("rejects malformed success responses instead of showing them", async () => {
    mockFetch(() => json(200, { prediction: { probability: 7 } }));
    await expect(api.predict(customer)).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("times out slow requests", async () => {
    vi.useFakeTimers();
    mockFetch((_url, init) =>
      new Promise((_, reject) => {
        (init as RequestInit).signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    );
    const p = api.health().catch((e) => e);
    await vi.advanceTimersByTimeAsync(16000);
    expect((await p).kind).toBe("timeout");
  });

  it("validates real predict responses", () => {
    expect(isPredictResponse(predict)).toBe(true);
    expect(isPredictResponse({})).toBe(false);
  });
});
