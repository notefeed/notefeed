"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

// `compact`: the icon alone, named by `label` for screen readers.
export function CopyButton({ text, compact = false, label = "Copy" }: { text: string; compact?: boolean; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = () =>
    // navigator.clipboard only exists in secure contexts (https or localhost).
    (navigator.clipboard?.writeText(text) ?? Promise.reject()).then(
      () => setState("copied"),
      () => setState("failed"),
    );
  const icon = state === "copied" ? <Check aria-hidden className="h-4 w-4" /> : <Copy aria-hidden className="h-4 w-4" />;
  if (compact)
    return (
      <button type="button" onClick={copy} aria-label={state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label} title={label} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink hover:bg-surface">
        {icon}
      </button>
    );
  return (
    <button type="button" onClick={copy} className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-sm font-bold text-ink hover:bg-rule/60">
      {icon}
      <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}</span>
    </button>
  );
}
