import { useId, useState } from "react";
import { Info } from "lucide-react";

/** Accessible tooltip: opens on hover and keyboard focus, closes with Escape. */
export function Tooltip({ text, label = "More information" }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="tip" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className="tip-btn"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      >
        <Info size={15} aria-hidden="true" />
      </button>
      {open && (
        <span role="tooltip" id={id} className="tip-bubble">
          {text}
        </span>
      )}
    </span>
  );
}
