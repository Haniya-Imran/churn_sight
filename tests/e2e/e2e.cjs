/*
 * End-to-end check against the REAL running backend + frontend (no mocks).
 *
 *   1. start the API:      uvicorn backend.app.main:app --port 8000
 *   2. start the frontend: (cd frontend && npm run dev)
 *   3. run:                node tests/e2e/e2e.cjs
 *
 * Requires Playwright (`npm i -g playwright && npx playwright install chromium`,
 * or set NODE_PATH to a folder that contains it).
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const APP = process.env.E2E_APP_URL || "http://127.0.0.1:5173";
const API = process.env.E2E_API_URL || "http://localhost:8000";
const results = [];

async function step(name, fn) {
  try {
    await fn();
    results.push(["PASS", name]);
    console.log("PASS", name);
  } catch (e) {
    results.push(["FAIL", name, e.message]);
    console.log("FAIL", name, "\n   ", e.message.split("\n")[0]);
  }
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const consoleProblems = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") consoleProblems.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => consoleProblems.push(`pageerror: ${e.message}`));

  await step("landing page loads without sign-in and shows real metrics", async () => {
    await page.goto(APP + "/", { waitUntil: "networkidle" });
    await page.getByRole("heading", { level: 1, name: /know which customers will leave/i }).waitFor();
    const info = await (await fetch(API + "/model-info")).json();
    await page.getByText(info.test_metrics.roc_auc.toFixed(3)).first().waitFor();
    assert.equal(await page.getByText(/password|sign in to|log in/i).count(), 0);
  });

  await step("3D hero scene renders and springs back after dragging", async () => {
    const stage = page.locator(".hero-stage");
    await stage.waitFor();
    const scene = page.locator(".hero-scene");
    const rest = await scene.evaluate((el) => el.style.transform);
    const box = await stage.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 + 40, { steps: 8 });
    const dragged = await scene.evaluate((el) => el.style.transform);
    assert.notEqual(dragged, rest, "scene should rotate while dragging");
    await page.mouse.up();
    await page.mouse.move(box.x - 50, box.y - 50); // leave the stage so hover parallax doesn't apply
    await page.waitForTimeout(1200);
    assert.equal(await scene.evaluate((el) => el.style.transform), rest, "scene should spring back");
  });

  await step("keyboard: Get started is reachable with Tab and opens the app", async () => {
    await page.goto(APP + "/", { waitUntil: "networkidle" });
    let found = false;
    for (let i = 0; i < 12 && !found; i++) {
      await page.keyboard.press("Tab");
      found = await page.evaluate(() => document.activeElement?.textContent?.trim() === "Get started");
    }
    assert.ok(found, "Get started should be focusable");
    const ring = await page.evaluate(() => getComputedStyle(document.activeElement).boxShadow);
    assert.notEqual(ring, "none", "focused element should have a visible focus ring");
    await page.keyboard.press("Enter");
    await page.getByRole("heading", { name: /predict a customer/i }).waitFor();
  });

  await step("form fields exactly match the backend model features", async () => {
    const info = await (await fetch(API + "/model-info")).json();
    await page.locator("#f-tenure").waitFor();
    const names = await page.$$eval("form [name]", (els) => els.map((e) => e.getAttribute("name")));
    assert.deepEqual([...names].sort(), [...info.features.order].sort());
    for (const [k, spec] of Object.entries(info.features.categorical)) {
      const opts = await page.$$eval(`#f-${k} option`, (os) => os.map((o) => o.value));
      for (const o of opts) assert.ok(spec.options.includes(o), `${k} offers unsupported option ${o}`);
    }
  });

  await step("invalid input is caught before sending", async () => {
    let calls = 0;
    const onReq = (r) => r.url().endsWith("/predict") && calls++;
    page.on("request", onReq);
    await page.fill("#f-tenure", "1.5");
    await page.getByRole("button", { name: /predict churn/i }).click();
    await page.getByText(/use whole months/i).waitFor();
    assert.equal(await page.locator("#f-tenure").getAttribute("aria-invalid"), "true");
    assert.equal(calls, 0);
    page.off("request", onReq);
  });

  let manual;
  await step("complete prediction from the UI using the trained model", async () => {
    await page.fill("#f-tenure", "2");
    await page.selectOption("#f-Contract", "Month-to-month");
    await page.fill("#f-MonthlyCharges", "89.5");
    await page.getByRole("button", { name: /use estimate/i }).click();
    assert.equal(await page.inputValue("#f-TotalCharges"), "179");
    await page.selectOption("#f-InternetService", "Fiber optic");
    await page.selectOption("#f-PaymentMethod", "Electronic check");
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/predict") && r.request().method() === "POST"),
      page.getByRole("button", { name: /predict churn/i }).click(),
    ]);
    assert.equal(resp.status(), 200);
    manual = await resp.json();
    await page.locator(".orb-value").waitFor();
    await page.waitForTimeout(1100); // count-up animation
    const shown = await page.locator(".orb-value").innerText();
    assert.equal(shown, `${Math.round(manual.prediction.probability * 100)}%`);
    await page.getByRole("heading", { name: "SHAP explanation" }).waitFor();
  });

  await step("SHAP explanation matches the prediction (additivity + displayed factors)", async () => {
    const e = manual.explanation;
    const total = e.base_value + e.contributions.reduce((s, c) => s + c.shap_value, 0);
    assert.ok(Math.abs(total - e.model_output) < 1e-3, "contributions must sum to model output");
    const p = 1 / (1 + Math.exp(-e.model_output));
    assert.ok(Math.abs(p - manual.prediction.probability) < 1e-3, "model output must equal shown probability");
    const why = page.locator(".why-card");
    for (const c of e.top_increasing.slice(0, 3)) await why.getByText(c.label, { exact: false }).first().waitFor();
    assert.equal(await page.locator(".wf-row").count(), 13); // base + 10 factors + "others" + output
  });

  await step("recommendations reflect the explanation's risk drivers", async () => {
    const byFeature = Object.fromEntries(manual.explanation.contributions.map((c) => [c.feature, c]));
    for (const r of manual.recommendations.slice(1)) {
      for (const d of r.drivers) assert.ok(byFeature[d].shap_value > 0, `${r.id} cites a non-risk factor`);
      await page.getByRole("heading", { name: r.title }).waitFor();
    }
    assert.ok(manual.recommendations.some((r) => r.id === "contract-upgrade"));
  });

  await step("report download and JSON export work", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-"));
    const [d1] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /download report/i }).click()]);
    const f1 = path.join(dir, d1.suggestedFilename());
    await d1.saveAs(f1);
    const html = fs.readFileSync(f1, "utf8");
    assert.match(html, /Retentra prediction report/);
    assert.ok(html.includes(`${Math.round(manual.prediction.probability * 100)}% churn probability`));
    const [d2] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /export json/i }).click()]);
    const f2 = path.join(dir, d2.suggestedFilename());
    await d2.saveAs(f2);
    const json = JSON.parse(fs.readFileSync(f2, "utf8"));
    assert.equal(json.prediction.probability, manual.prediction.probability);
  });

  await step("changing inputs marks the result as outdated", async () => {
    await page.selectOption("#f-Contract", "Two year");
    await page.getByText(/inputs changed since this result/i).waitFor();
  });

  await step("demo customer, session history re-run and reset", async () => {
    await page.getByRole("button", { name: "Low-risk example" }).click();
    await page.locator(".orb-stage.band-Low").waitFor();
    const hist = page.locator(".history li");
    assert.equal(await hist.count(), 2);
    await hist.nth(1).getByRole("button", { name: "Re-run" }).click();
    await page.waitForFunction(() => document.querySelectorAll(".history li").length === 3);
    await page.getByRole("button", { name: /^reset$/i }).click();
    assert.equal(await page.inputValue("#f-tenure"), "");
    assert.equal(await page.locator(".orb-stage.empty").count(), 1);
    await page.getByRole("button", { name: /^clear$/i }).click();
    await page.getByText("No predictions yet.").waitFor();
  });

  await step("dashboard shows real analytics and 'Analyse' runs the model", async () => {
    await page.getByRole("link", { name: "Dashboard", exact: true }).click();
    const a = await (await fetch(API + "/analytics/overview")).json();
    await page.getByText(`${(a.totals.churn_rate * 100).toFixed(1)}%`).first().waitFor();
    const top = a.top_risk_customers[1];
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/predict")),
      page.getByRole("button", { name: `Analyse customer ${top.customer_id}` }).click(),
    ]);
    const body = await resp.json();
    assert.ok(Math.abs(body.prediction.probability - top.probability) < 1e-3);
    await page.getByText(`#${top.customer_id}`).first().waitFor();
  });

  await step("model page shows real metrics", async () => {
    await page.getByRole("link", { name: "Model", exact: true }).click();
    const info = await (await fetch(API + "/model-info")).json();
    await page.getByText(String(info.test_metrics.confusion_matrix.tp), { exact: true }).waitFor();
  });

  await step("backend unavailable: clear error, no fake result", async () => {
    await page.goto(APP + "/predict", { waitUntil: "networkidle" });
    await page.route(API + "/predict", (route) => route.abort("connectionrefused"));
    await page.getByRole("button", { name: "High-risk example" }).click();
    await page.getByText(/can't reach the retentra server/i).waitFor();
    assert.equal(await page.locator(".orb-value").count(), 0);
    await page.unroute(API + "/predict");
    await page.getByRole("button", { name: /try again/i }).click();
    await page.locator(".orb-value").waitFor();
  });

  await step("reduced motion: 3D scene stays still", async () => {
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const p = await ctx.newPage();
    await p.goto(APP + "/", { waitUntil: "networkidle" });
    assert.equal(await p.locator(".hero-stage.still").count(), 1);
    assert.equal(await p.locator(".hero-hint").count(), 0);
    await ctx.close();
  });

  await step("mobile layout has no horizontal scrolling", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const p = await ctx.newPage();
    for (const route of ["/", "/dashboard", "/predict", "/model"]) {
      await p.goto(APP + route, { waitUntil: "networkidle" });
      const sw = await p.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(sw <= 391, `${route} is ${sw}px wide`);
    }
    await ctx.close();
  });

  await step("no console errors or warnings", async () => {
    assert.deepEqual(consoleProblems.filter((m) => !/ERR_CONNECTION_REFUSED|Failed to load resource/.test(m)), []);
  });

  await browser.close();
  const failed = results.filter((r) => r[0] === "FAIL");
  console.log(`\n${results.length - failed.length}/${results.length} end-to-end checks passed`);
  process.exit(failed.length ? 1 : 0);
})();
