"use client";
import type { MouseEvent, ReactNode } from "react";

// A note's card in a list (ADR 0040): a click anywhere on it opens the note, through the note's own link (its time in the foot,
// marked data-open, for keyboards, screen readers and opening in a new tab). Not a click on a link or control inside the card,
// one with a modifier key, or one that ends a text selection.
export function NoteCard({ className, children }: { className: string; children: ReactNode }) {
  const open = (e: MouseEvent<HTMLLIElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if ((e.target as Element).closest("a, button, input, textarea, select, label, summary, audio, video")) return;
    if (window.getSelection()?.toString()) return;
    e.currentTarget.querySelector<HTMLAnchorElement>("a[data-open]")?.click();
  };
  return (
    <li className={`${className} cursor-pointer`} onClick={open}>
      {children}
    </li>
  );
}
