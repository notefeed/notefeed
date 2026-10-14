"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";

// A <details> that opens a menu or a sheet: without JavaScript the summary opens and closes it; with it, Escape, a tap
// outside and following a link inside close it too. `sheet` adds a dimmed backdrop (only once hydrated: without
// JavaScript the backdrop could not be tapped away).
export function Disclosure({ summary, label, children, className = "", summaryClassName = "", sheet = false }: { summary: ReactNode; label: string; children: ReactNode; className?: string; summaryClassName?: string; sheet?: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);

  useEffect(() => {
    const details = ref.current;
    if (!details) return;
    const close = () => {
      details.open = false;
    };
    const outside = (e: PointerEvent) => {
      if (details.open && !details.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && details.open) {
        close();
        details.querySelector("summary")?.focus();
      }
    };
    const link = (e: MouseEvent) => {
      if ((e.target as Element).closest("a")) close();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    details.addEventListener("click", link);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
      details.removeEventListener("click", link);
    };
  }, []);

  return (
    <details ref={ref} className={`group/disclosure ${className}`}>
      <summary aria-label={label} title={label} className={`cursor-pointer select-none ${summaryClassName}`}>
        {summary}
      </summary>
      {sheet && hydrated && <div aria-hidden className="fixed inset-0 z-40 bg-ink/40" onClick={() => ref.current && (ref.current.open = false)} />}
      {children}
    </details>
  );
}
