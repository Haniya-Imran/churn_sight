import { formatValue, pct, signed, strengthLabel } from "../lib/format";
import type { Contribution } from "../lib/types";

/* All charts are plain SVG/HTML: light, crisp and accessible (each has a text alternative). */

export function Donut({
  segments,
  size = 110,
  label,
}: {
  segments: { value: number; color: string; name: string }[];
  size?: number;
  label: string;
}) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" role="img" aria-label={label}>
      <circle cx="40" cy="40" r={r} fill="none" stroke="rgba(30,42,94,.1)" strokeWidth="13" />
      {segments.map((s) => {
        const len = (s.value / total) * c;
        const el = (
          <circle
            key={s.name}
            cx="40"
            cy="40"
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth="13"
            strokeDasharray={`${len} ${c}`}
            strokeDashoffset={-offset}
            transform="rotate(-90 40 40)"
          />
        );
        offset += len;
        return el;
      })}
    </svg>
  );
}

export function RateBars({
  rows,
  highlight,
  max,
}: {
  rows: { label: string; value: number; detail?: string }[];
  highlight?: (label: string, value: number) => boolean;
  max?: number;
}) {
  const top = max ?? Math.max(...rows.map((r) => r.value), 0.0001);
  return (
    <ul className="rate-bars">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="rate-bars-head">
            <span>{r.label}</span>
            <span className="rate-bars-val">{pct(r.value, 0)}</span>
          </div>
          <div className="meter" aria-hidden="true">
            <span style={{ width: `${(r.value / top) * 100}%`, background: highlight?.(r.label, r.value) ? "var(--risk-high)" : undefined }} />
          </div>
          {r.detail && <span className="rate-bars-detail">{r.detail}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Area chart of churn rate across tenure bands (real dataset values). */
export function TenureArea({ rows }: { rows: { group: string; churn_rate: number }[] }) {
  const w = 300;
  const h = 110;
  const pad = 6;
  const max = Math.max(...rows.map((r) => r.churn_rate)) * 1.1;
  const pts = rows.map((r, i) => [pad + (i * (w - 2 * pad)) / (rows.length - 1), h - 14 - (r.churn_rate / max) * (h - 28)]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0]} ${h - 14} L${pts[0][0]} ${h - 14} Z`;
  const desc = rows.map((r) => `${r.group} months: ${pct(r.churn_rate)}`).join("; ");
  return (
    <svg viewBox={`0 0 ${w} ${h + 6}`} className="tenure-area" role="img" aria-label={`Churn rate by tenure. ${desc}`}>
      <defs>
        <linearGradient id="tenure-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6C83FF" stopOpacity=".85" />
          <stop offset="1" stopColor="#6C83FF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#tenure-fill)" />
      <path d={line} fill="none" stroke="#9FB0FF" strokeWidth="2.5" strokeLinejoin="round" />
      {pts.map(([x, y], i) => (
        <g key={rows[i].group}>
          <circle cx={x} cy={y} r={i === 0 ? 4.5 : 3} fill="#fff" stroke="#6C83FF" strokeWidth="2" />
          <text x={x} y={h + 4} textAnchor={i === 0 ? "start" : i === rows.length - 1 ? "end" : "middle"} fontSize="9" fill="#AEB9E0">
            {rows[i].group}
          </text>
        </g>
      ))}
    </svg>
  );
}

/**
 * SHAP waterfall for one customer: starts from the base value and adds each
 * contribution (in log-odds) until it reaches the model's output.
 */
export function ShapWaterfall({
  contributions,
  baseValue,
  output,
  baseProbability,
  probability,
  limit = 10,
}: {
  contributions: Contribution[];
  baseValue: number;
  output: number;
  baseProbability: number;
  probability: number;
  limit?: number;
}) {
  const shown = contributions.slice(0, limit);
  const rest = contributions.slice(limit);
  const restSum = rest.reduce((s, c) => s + c.shap_value, 0);
  const steps: { name: string; value: string; delta: number; start: number; end: number; strength?: string }[] = [];
  let cur = baseValue;
  for (const c of shown) {
    steps.push({ name: c.label, value: formatValue(c.feature, c.value), delta: c.shap_value, start: cur, end: cur + c.shap_value, strength: strengthLabel(c.impact_pct_points) });
    cur += c.shap_value;
  }
  if (rest.length) {
    steps.push({ name: `${rest.length} other factors`, value: "combined", delta: restSum, start: cur, end: cur + restSum });
    cur += restSum;
  }
  const all = [baseValue, output, ...steps.flatMap((s) => [s.start, s.end])];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || 1;
  const x = (v: number) => ((v - lo) / span) * 100;

  return (
    <div className="waterfall">
      <div className="wf-row wf-edge">
        <span className="wf-name">Typical customer (base)</span>
        <span className="wf-track">
          <span className="wf-marker" style={{ left: `${x(baseValue)}%` }} />
        </span>
        <span className="wf-num">{pct(baseProbability)}</span>
      </div>
      {steps.map((s) => {
        const left = Math.min(x(s.start), x(s.end));
        const width = Math.max(Math.abs(x(s.end) - x(s.start)), 0.8);
        const up = s.delta > 0;
        return (
          <div className="wf-row" key={s.name}>
            <span className="wf-name">
              {s.name}
              <span className="wf-val">{s.value}</span>
            </span>
            <span className="wf-track" aria-hidden="true">
              <span className={`wf-bar ${up ? "up" : "down"}`} style={{ left: `${left}%`, width: `${width}%` }} />
            </span>
            <span className={`wf-num ${up ? "up" : "down"}`}>
              {signed(s.delta, 2)}
              <span className="sr-only">{up ? " raises risk" : " lowers risk"}</span>
            </span>
          </div>
        );
      })}
      <div className="wf-row wf-edge">
        <span className="wf-name">This customer (model output)</span>
        <span className="wf-track">
          <span className="wf-marker strong" style={{ left: `${x(output)}%` }} />
        </span>
        <span className="wf-num">{pct(probability)}</span>
      </div>
      <p className="wf-legend muted">
        Bars show SHAP contributions in log-odds (the model's internal risk score). <span className="up">Orange</span> raises risk,{" "}
        <span className="down">blue</span> lowers it. Base {signed(baseValue, 2)} → output {signed(output, 2)}.
      </p>
    </div>
  );
}
