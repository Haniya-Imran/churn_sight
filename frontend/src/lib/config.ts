// The API base URL comes from VITE_API_BASE_URL. The localhost fallback is only
// used by the dev server; a production build without the variable calls the API
// on the same origin (e.g. behind a reverse proxy).
const fallback = import.meta.env.DEV ? "http://localhost:8000" : "";
const rawBase = import.meta.env.VITE_API_BASE_URL ?? fallback;

export const API_BASE_URL = rawBase.replace(/\/+$/, "");
export const API_TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS ?? 15000) || 15000;
