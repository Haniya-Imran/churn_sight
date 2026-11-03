import modelInfo from "./fixtures/model-info.json";
import { ALL_FIELDS, DEFAULT_VALUES, applyDependencies, estimateTotal, fromCustomer, optionsFor, toPayload, validate } from "../lib/form";
import type { FeatureSpecs } from "../lib/form";
import type { CustomerInput } from "../lib/types";

const specs = modelInfo.features as unknown as FeatureSpecs;
const valid = { ...DEFAULT_VALUES, tenure: "12", MonthlyCharges: "70.35", TotalCharges: "844.2" };

describe("form schema", () => {
  it("covers exactly the backend model's features", () => {
    expect([...ALL_FIELDS].sort()).toEqual([...modelInfo.features.order].sort());
  });

  it("defaults are valid options from the backend", () => {
    for (const [k, spec] of Object.entries(specs.categorical)) {
      expect(spec.options).toContain(DEFAULT_VALUES[k as keyof typeof DEFAULT_VALUES]);
    }
  });
});

describe("validate", () => {
  it("accepts a complete customer", () => {
    expect(validate(valid, specs)).toEqual({});
  });

  it("requires numeric fields", () => {
    const errs = validate(DEFAULT_VALUES, specs);
    expect(Object.keys(errs).sort()).toEqual(["MonthlyCharges", "TotalCharges", "tenure"]);
  });

  it("rejects fractional tenure, out-of-range and non-numeric values", () => {
    expect(validate({ ...valid, tenure: "1.5" }, specs).tenure).toMatch(/whole/);
    expect(validate({ ...valid, tenure: "500" }, specs).tenure).toMatch(/between/);
    expect(validate({ ...valid, MonthlyCharges: "-3" }, specs).MonthlyCharges).toMatch(/between/);
    expect(validate({ ...valid, MonthlyCharges: "abc" }, specs).MonthlyCharges).toBeTruthy();
  });

  it("applies the same total-charges rules as the backend", () => {
    expect(validate({ ...valid, tenure: "0", TotalCharges: "50" }, specs).TotalCharges).toMatch(/0 months/);
    expect(validate({ ...valid, TotalCharges: "99999" }, specs).TotalCharges).toBeTruthy();
  });

  it("rejects unsupported categories", () => {
    expect(validate({ ...valid, Contract: "Weekly" }, specs).Contract).toBeTruthy();
  });
});

describe("dependent fields", () => {
  it("locks internet add-ons when there is no internet", () => {
    const v = applyDependencies({ ...valid, InternetService: "No" }, "InternetService");
    expect(v.OnlineSecurity).toBe("No internet service");
    expect(v.StreamingMovies).toBe("No internet service");
    const back = applyDependencies({ ...v, InternetService: "DSL" }, "InternetService");
    expect(back.OnlineSecurity).toBe("No");
  });

  it("locks multiple lines when there is no phone service", () => {
    expect(applyDependencies({ ...valid, PhoneService: "No" }, "PhoneService").MultipleLines).toBe("No phone service");
    expect(applyDependencies({ ...valid, PhoneService: "Yes", MultipleLines: "No phone service" }, "PhoneService").MultipleLines).toBe("No");
  });

  it("offers only consistent options", () => {
    const opts = optionsFor("TechSupport", valid, specs.categorical.TechSupport);
    expect(opts).not.toContain("No internet service");
  });

  it("sets total charges to 0 for zero tenure", () => {
    expect(applyDependencies({ ...valid, tenure: "0" }, "tenure").TotalCharges).toBe("0");
  });
});

describe("payload conversion", () => {
  it("converts numbers and round-trips a customer", () => {
    const payload = toPayload(valid);
    expect(payload.tenure).toBe(12);
    expect(payload.MonthlyCharges).toBe(70.35);
    expect(fromCustomer(payload as CustomerInput)).toEqual(valid);
  });

  it("estimates total charges", () => {
    expect(estimateTotal(valid)).toBe("844.2");
    expect(estimateTotal(DEFAULT_VALUES)).toBeNull();
  });
});
