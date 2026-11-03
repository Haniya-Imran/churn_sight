import type { CustomerInput, RiskBand } from "./types";

/** Prediction history for the current browser tab only (sessionStorage). */
export type HistoryEntry = {
  id: string;
  at: string;
  label: string;
  input: CustomerInput;
  probability: number;
  band: RiskBand;
};

const KEY = "churnsight.history.v1";
const MAX = 20;

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveHistory(entries: HistoryEntry[]): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX)));
  } catch {
    /* storage unavailable: history simply isn't kept */
  }
}

export function clearHistoryStorage(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function addEntry(entries: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [entry, ...entries].slice(0, MAX);
}
