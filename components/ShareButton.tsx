"use client";

import { Check, Share2 } from "lucide-react";
import { useState } from "react";
import { copyText } from "@/components/copy";

// Shares the feed's read link: the system share sheet where there is one (secure contexts only), else the link goes to
// the clipboard.
export function ShareButton({ url, title }: { url: string; title: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ url, ...(title && { title }) });
      } catch {} // dismissed
      return;
    }
    await copyText(url).then(
      () => setState("copied"),
      () => setState("failed"),
    );
  }
  return (
    <button type="button" onClick={share} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-surface-2 px-3 py-2 text-[14px] font-bold text-ink hover:bg-rule/60">
      {state === "copied" ? <Check aria-hidden className="h-4 w-4" /> : <Share2 aria-hidden className="h-4 w-4" />}
      <span aria-live="polite">{state === "copied" ? "Link copied" : state === "failed" ? "Copy failed" : "Share"}</span>
    </button>
  );
}
