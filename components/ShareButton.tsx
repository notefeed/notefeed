"use client";

import { Check, Share2 } from "lucide-react";
import { useState } from "react";

// Shares the feed's read link: the system share sheet where there is one, else the link goes to the clipboard.
export function ShareButton({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false);
  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ url, ...(title && { title }) });
      } catch {} // dismissed
      return;
    }
    // navigator.clipboard only exists in secure contexts (https or localhost).
    await navigator.clipboard?.writeText(url).then(() => setCopied(true), () => {});
  }
  return (
    <button type="button" onClick={share} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-surface-2 px-3 py-2 text-[14px] font-bold text-ink hover:bg-rule/60">
      {copied ? <Check aria-hidden className="h-4 w-4" /> : <Share2 aria-hidden className="h-4 w-4" />}
      <span aria-live="polite">{copied ? "Link copied" : "Share"}</span>
    </button>
  );
}
