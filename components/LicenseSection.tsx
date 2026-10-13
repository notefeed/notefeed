"use client";

import { BadgeCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorMessage } from "@/app/_lib/messages";
import { heading } from "@/components/styles";

const input = "min-w-0 flex-1 rounded-sm border border-rule bg-transparent px-3 py-1.5 focus:border-carbon focus:outline-none";

// On a feed's settings page while the instance sells licenses (ADR 0029): the feed's tier, a field for a key, and a way to take it off.
export function LicenseSection({ feed, licensed }: { feed: string; licensed: boolean }) {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [error, setError] = useState("");

  async function send(method: "POST" | "DELETE") {
    setError("");
    const res = await fetch("/api/licenses/attach", { method, headers: { "content-type": "application/json" }, body: JSON.stringify({ feed, key }) });
    if (res.ok) {
      setKey("");
      router.refresh();
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    setError(body.error && body.code === "invalid_body" ? `${body.error[0].toUpperCase()}${body.error.slice(1)}.` : (errorMessage(body.code) ?? "Something went wrong."));
  }

  return (
    <section aria-labelledby="license" className="text-sm">
      <h2 id="license" className={heading}>
        <BadgeCheck aria-hidden className="h-4 w-4" />
        License
      </h2>
      {licensed ? (
        <>
          <p className="text-muted">This feed has a license: no cap on stored notes, a feed password and images.</p>
          <button type="button" onClick={() => send("DELETE")} className="mt-3 rounded-sm border border-rule px-3 py-1.5 text-muted hover:border-carbon hover:text-ink">
            Take the license off this feed
          </button>
        </>
      ) : (
        <>
          <p className="text-muted">
            This feed is on the free tier: it keeps its newest notes, and has no images and no feed password. <Link href="/license" className="underline">
              Buy a license
            </Link>, then enter its key.
          </p>
          <form
            className="mt-3 flex max-w-xl gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send("POST");
            }}
          >
            <label htmlFor="license-key" className="sr-only">
              License key
            </label>
            <input id="license-key" value={key} onChange={(e) => setKey(e.target.value)} required maxLength={64} autoComplete="off" spellCheck={false} aria-describedby="license-error" className={`${input} font-mono`} />
            <button type="submit" className="rounded-sm bg-carbon px-4 py-1.5 font-bold text-on-carbon">
              Use key
            </button>
          </form>
        </>
      )}
      <p id="license-error" role="alert" className="mt-2 text-error">
        {error}
      </p>
    </section>
  );
}
