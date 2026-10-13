"use client";

import { KeyRound } from "lucide-react";
import { useEffect, useState } from "react";
import { errorMessage } from "@/app/_lib/messages";
import { CopyButton } from "@/components/CopyButton";

// The page a buyer lands on (ADR 0029). Before paying: a button that opens the provider's checkout. After: the key, which is in the
// fragment of this page's URL, so no server has received it; notefeed keeps only its hash and cannot show it again.
export function BuyLicense() {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const k = window.location.hash.slice(1);
    // A hash is set after the first render; the state follows it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (/^[A-Za-z0-9_-]{22,64}$/.test(k)) setKey(k);
  }, []);

  async function buy() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/licenses/checkout", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { url?: string; code?: string; retry?: string };
      if (!res.ok || !body.url) throw new Error(errorMessage(body.code) ?? "Something went wrong.");
      window.location.assign(body.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  if (key) {
    return (
      <section aria-labelledby="your-key" className="max-w-xl text-sm">
        <h2 id="your-key" className="mb-3 flex items-center gap-2 text-base font-bold">
          <KeyRound aria-hidden className="h-4 w-4" />
          Your license key
        </h2>
        <div className="flex items-center gap-3">
          <code className="min-w-0 break-all font-mono text-carbon">{key}</code>
          <CopyButton text={key} />
        </div>
        <p className="mt-3 text-muted">
          Keep this key. notefeed stores no information about you, so it cannot show the key again or recover a lost one. Enter it under <em>License</em> in a
          feed&apos;s settings. It works for one feed at a time and can be moved to another.
        </p>
        <p className="mt-2 text-muted">The payment provider&apos;s receipt is the record of your purchase.</p>
      </section>
    );
  }
  return (
    <div className="max-w-xl text-sm">
      <p className="mb-4 text-muted">
        A license lifts the free tier&apos;s limits for one feed: no cap on stored notes, a feed password and images. Reading a feed is always free, and
        there are no accounts: the license is a key you keep.
      </p>
      <button type="button" disabled={busy} onClick={buy} className="rounded-sm bg-carbon px-4 py-1.5 font-bold text-on-carbon disabled:opacity-60">
        Buy a license
      </button>
      <p id="buy-error" role="alert" className="mt-2 text-error">
        {error}
      </p>
    </div>
  );
}
