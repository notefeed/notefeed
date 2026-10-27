"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

// A ```mermaid block on a note's page (#243), drawn in the browser: mermaid is loaded only when a page has one, and its strict security
// level sanitizes the diagram's SVG (no scripts, no HTML labels, no click handlers). Until it is drawn, and when it can't be (a syntax
// error, no JavaScript), the source shows as the code block it is; once drawn, the source stays one click away. RSS keeps the source.
// A click on the drawn diagram opens it enlarged in a dialog (#301): it fills the screen and scrolls when larger; Esc, the close
// button or a click beside it closes it.
export function MermaidBlock({ source, children }: { source: string; children: ReactNode }) {
  const id = `mermaid-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const [svg, setSvg] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
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
      <button type="button" onClick={() => dialog.current?.showModal()} aria-label="Enlarge diagram" title="Enlarge diagram" className="block w-full cursor-zoom-in overflow-x-auto text-left">
        {/* Sanitized by mermaid (securityLevel "strict"). */}
        <div dangerouslySetInnerHTML={{ __html: svg }} />
      </button>
      <dialog
        ref={dialog}
        aria-label="Diagram"
        onClick={(e) => e.target === e.currentTarget && dialog.current?.close()}
        className="mermaid-enlarged m-auto h-[calc(100dvh-2rem)] max-h-none w-[calc(100vw-2rem)] max-w-none rounded-2xl bg-surface p-0 text-ink backdrop:bg-black/60"
      >
        <div className="flex h-full flex-col">
          <div className="flex justify-end p-2">
            <button type="button" onClick={() => dialog.current?.close()} aria-label="Close" className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink">
              <X aria-hidden className="h-5 w-5" />
            </button>
          </div>
          {/* The same sanitized SVG, drawn as large as the screen allows. */}
          <div className="min-h-0 flex-1 overflow-auto px-4 pb-4" dangerouslySetInnerHTML={{ __html: svg }} />
        </div>
      </dialog>
      <details className="mt-1 text-[13px] text-muted">
        <summary className="cursor-pointer">Diagram source</summary>
        {children}
      </details>
    </figure>
  );
}
