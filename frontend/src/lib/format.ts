export const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;
export const num = (x: number) => x.toLocaleString("en-US");
export const usd = (x: number, digits = 2) =>
  x.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
export const usdShort = (x: number) => (x >= 1000 ? `$${(x / 1000).toFixed(0)}K` : usd(x, 0));

export function formatValue(feature: string, value: string | number): string {
  if (feature === "tenure") {
    const n = Number(value);
    return n === 1 ? "1 month" : `${n} months`;
  }
  if (feature === "MonthlyCharges" || feature === "TotalCharges") return usd(Number(value));
  return String(value);
}

export const signed = (x: number, digits = 1) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(digits)}`;

export function strengthLabel(impactPts: number): string {
  const a = Math.abs(impactPts);
  if (a >= 8) return "Strong";
  if (a >= 3) return "Moderate";
  return "Slight";
}

export const bandColor = (band: string) =>
  band === "High" ? "var(--risk-high)" : band === "Medium" ? "var(--risk-medium)" : "var(--risk-low)";
