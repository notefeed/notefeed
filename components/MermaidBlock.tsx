"use client";

import { useEffect, useId, useState, type ReactNode } from "react";

// A ```mermaid block on a note's page (#243), drawn in the browser: mermaid is loaded only when a page has one, and its strict security
// level sanitizes the diagram's SVG (no scripts, no HTML labels, no click handlers). Until it is drawn, and when it can't be (a syntax
// error, no JavaScript), the source shows as the code block it is; once drawn, the source stays one click away. RSS keeps the source.
export function MermaidBlock({ source, children }: { source: string; children: ReactNode }) {
  const id = `mermaid-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    import("mermaid")
      .then(async ({ default: mermaid }) => {
        const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "neutral" });
        const drawn = await mermaid.render(id, source);
        if (live) setSvg(drawn.svg);
      })
      .catch(() => document.getElementById(`d${id}`)?.remove()); // mermaid leaves its error drawing in the body
    return () => {
      live = false;
    };
  }, [id, source]);
  if (!svg) return children;
  return (
    <figure className="mermaid-diagram">
      {/* Sanitized by mermaid (securityLevel "strict"). */}
      <div className="overflow-x-auto" dangerouslySetInnerHTML={{ __html: svg }} />
      <details className="mt-1 text-[13px] text-muted">
        <summary className="cursor-pointer">Diagram source</summary>
        {children}
      </details>
    </figure>
  );
}
