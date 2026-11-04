import { formatValue, pct, signed } from "./format";
import type { CustomerInput, PredictResponse } from "./types";

const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export function reportFileName(label: string, ext: string): string {
  const safe = label.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "customer";
  return `retentra-${safe}-${new Date().toISOString().slice(0, 10)}.${ext}`;
}

export function buildReportHtml(label: string, input: CustomerInput, r: PredictResponse, featureLabels: Record<string, string>): string {
  const p = r.prediction;
  const inputs = (Object.keys(input) as (keyof CustomerInput)[])
    .map((k) => `<tr><td>${esc(featureLabels[k] ?? k)}</td><td>${esc(formatValue(k, input[k]))}</td></tr>`)
    .join("");
  const contribs = r.explanation.contributions
    .map(
      (c) =>
        `<tr><td>${esc(c.label)}</td><td>${esc(formatValue(c.feature, c.value))}</td><td class="${c.shap_value > 0 ? "up" : "down"}">${esc(
          signed(c.impact_pct_points),
        )} pts</td><td>${esc(c.shap_value.toFixed(4))}</td></tr>`,
    )
    .join("");
  const recs = r.recommendations
    .map(
      (x) =>
        `<li><strong>[${esc(x.priority)}] ${esc(x.title)}</strong><br>${esc(x.action)}<br><em>Why:</em> ${esc(x.why)}<ul>${x.evidence
          .map((e) => `<li>${esc(e)}</li>`)
          .join("")}</ul><em>Assumption:</em> ${esc(x.assumption)}</li>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Retentra report — ${esc(label)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:860px;margin:32px auto;padding:0 20px;color:#1A2340;line-height:1.5}
h1{margin:0 0 4px}table{border-collapse:collapse;width:100%;margin:8px 0 24px}td,th{border-bottom:1px solid #d6dbea;padding:6px 8px;text-align:left;font-size:14px}
.big{font-size:40px;font-weight:700}.up{color:#B4521A}.down{color:#2C3FA8}.muted{color:#4a5578;font-size:13px}li{margin-bottom:10px}</style></head><body>
<h1>Retentra prediction report</h1><p class="muted">Customer: ${esc(label)} · Generated ${esc(new Date(r.generated_at).toLocaleString())} · Model: ${esc(
    r.model.name,
  )} v${esc(r.model.version)}</p>
<p class="big">${esc(pct(p.probability))} churn probability</p>
<p><strong>${esc(p.label)}</strong> · ${esc(p.risk_band)} risk (decision threshold ${esc(pct(p.threshold, 1))}, high-risk cut-off ${esc(pct(p.high_risk_cutoff))})</p>
<h2>Why this score</h2><p>${esc(r.explanation.summary)}</p>
<table><thead><tr><th>Factor</th><th>Customer value</th><th>Approx. impact</th><th>SHAP (log-odds)</th></tr></thead><tbody>${contribs}</tbody></table>
<p class="muted">${esc(r.explanation.note)} Base value ${esc(r.explanation.base_value.toFixed(4))} log-odds (${esc(pct(r.explanation.base_probability))}). Method: ${esc(
    r.explanation.method,
  )}.</p>
<h2>Retention suggestions</h2><ol>${recs}</ol>
<p class="muted">Suggestions are grounded in the model's explanation and dataset statistics. They are not guaranteed to prevent churn.</p>
<h2>Customer inputs</h2><table><tbody>${inputs}</tbody></table>
<p class="muted">Trained on the IBM Telco Customer Churn sample dataset. Results are estimates, not certainties.</p></body></html>`;
}

export function downloadFile(name: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
