import { AlertTriangle, RefreshCw } from "lucide-react";
import type { ApiError } from "../lib/api";

export function ErrorState({ error, onRetry, title = "Something went wrong" }: { error: ApiError | Error; onRetry?: () => void; title?: string }) {
  return (
    <div className="alert alert-error" role="alert">
      <AlertTriangle size={20} aria-hidden="true" style={{ flex: "none", marginTop: 2 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <strong>{title}</strong>
        <span>{error.message}</span>
        {onRetry && (
          <button type="button" className="btn btn-glass btn-sm" style={{ alignSelf: "flex-start" }} onClick={onRetry}>
            <RefreshCw size={15} aria-hidden="true" /> Try again
          </button>
        )}
      </div>
    </div>
  );
}

export function LoadingBlock({ label, height = 120 }: { label: string; height?: number }) {
  return (
    <div role="status" aria-live="polite" className="skeleton" style={{ height }}>
      <span className="sr-only">{label}</span>
    </div>
  );
}
