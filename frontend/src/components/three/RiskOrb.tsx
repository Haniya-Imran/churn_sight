import { useEffect, useMemo, useState } from "react";
import type { RiskBand } from "../../lib/types";
import { supports3D, usePrefersReducedMotion, useTilt } from "./useTilt";

const REST = { x: 0, y: 0 };

function useCountUp(target: number | null, reduced: boolean) {
  const [value, setValue] = useState(target ?? 0);
  useEffect(() => {
    if (target === null) return;
    if (reduced) {
      setValue(target);
      return;
    }
    let raf = 0;
    const from = 0;
    const t0 = performance.now();
    const dur = 900;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      setValue(from + (target - from) * eased);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced]);
  return value;
}

/** The 3D churn-risk orb on the Predict page. Shows empty, loading and result states. */
export function RiskOrb({
  probability,
  band,
  loading,
  caption,
  subcaption,
}: {
  probability: number | null;
  band: RiskBand | null;
  loading: boolean;
  caption: string;
  subcaption: string;
}) {
  const reduced = usePrefersReducedMotion();
  const has3D = useMemo(supports3D, []);
  const { rot, dragging, handlers } = useTilt(REST, { maxX: 20, maxY: 25, disabled: reduced || !has3D });
  const shown = useCountUp(probability === null ? null : probability * 100, reduced);
  const state = loading ? "loading" : probability === null ? "empty" : "result";

  return (
    <div className={`orb-stage ${state} band-${band ?? "none"}`} {...handlers}>
      <div
        className="orb-scene"
        style={{
          transform: `rotateX(${rot.x}deg) rotateY(${rot.y}deg)`,
          transition: dragging ? "transform 0.05s linear" : "transform 0.9s var(--ease-spring)",
        }}
      >
        <div className="orb-shadow" aria-hidden="true" />
        <div className="orb" aria-live="polite" aria-busy={loading}>
          {state === "empty" && (
            <div className="orb-text">
              <span className="orb-label">Churn risk</span>
              <span className="orb-empty">—</span>
              <span className="orb-hint">Enter details and press Predict</span>
            </div>
          )}
          {state === "loading" && (
            <div className="orb-text">
              <span className="orb-label">Analysing…</span>
              <span className="spinner orb-spinner" aria-hidden="true" />
            </div>
          )}
          {state === "result" && band && (
            <div className="orb-text">
              <span className="orb-label">Churn risk</span>
              <span className="orb-value">{Math.round(shown)}%</span>
              <span className={`badge badge-${band}`}>{band} risk</span>
            </div>
          )}
        </div>
        <div className="orb-ring" aria-hidden="true" />
      </div>
      <div className="orb-caption">
        <strong>{caption}</strong>
        <span>{subcaption}</span>
      </div>
    </div>
  );
}
