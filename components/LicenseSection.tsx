"use client";

import { BadgeCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorMessage } from "@/app/_lib/messages";
import { FreeTierBar, type FreeTierUsage } from "@/components/FreeTier";
import { DisclosureRow, Group } from "@/components/SettingsRows";
import { field, primary, secondary } from "@/components/styles";

// On a feed's settings page while the instance sells licenses (ADR 0029): the feed's tier (a free one with its notes against the cap,
// issue #183), a field for a key, and a way to take it off. `freeTier` is null for a licensed feed. `licensePage`: /license exists
// (ADR 0035), so the texts link to it.
export function LicenseSection({ feed, freeTier, licensePage }: { feed: string; freeTier: FreeTierUsage | null; licensePage: boolean }) {
  const licensed = freeTier === null;
  const router = useRouter();
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  async function send(method: "POST" | "DELETE") {
    setError("");
    setDone("");
    // Under the feed's path, where a protected feed's unlock cookie is sent.
    const res = await fetch(`/${encodeURIComponent(feed)}/license`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify({ key }) });
    if (res.ok) {
      setKey("");
      setDone(method === "POST" ? "The license is on this feed now." : "The license is off this feed. Its key can be entered on another feed.");
      router.refresh();
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    setError(body.error && body.code === "invalid_body" ? `${body.error[0].toUpperCase()}${body.error.slice(1)}.` : (errorMessage(body.code) ?? "Something went wrong."));
  }

  return (
    <Group id="license" label="License">
      <DisclosureRow
        icon={<BadgeCheck />}
        label="License"
        value={licensed ? <span className="rounded-full bg-carbon-soft px-2 py-0.5 text-[12px] font-bold text-carbon">Licensed</span> : `Free tier · ${Math.min(freeTier.notes, freeTier.cap)} of ${freeTier.cap} notes`}
      >
        {licensed ? (
          <>
            <p className="text-muted">
              This feed has a license: no cap on stored notes, a feed password and images.
              {licensePage && (
                <>
                  {" "}
                  To cancel the subscription, change how you pay or get an invoice, go to the{" "}
                  <Link href="/license" className="text-carbon underline">
                    license page
                  </Link>{" "}
                  with your key.
                </>
              )}
            </p>
            <button type="button" onClick={() => send("DELETE")} className={`${secondary} mt-3`}>
              Take the license off this feed
            </button>
          </>
        ) : (
          <>
            <FreeTierBar usage={freeTier} />
            <p className="mt-3 text-muted">
              This feed is on the free tier: it keeps its newest {freeTier.cap} notes, and has no images and no feed password.{" "}
              {licensePage ? (
                <>
                  <Link href="/license" className="text-carbon underline">
                    Buy a license
                  </Link>
                  , then enter its key.
                </>
              ) : (
                "Enter a license key to lift these limits."
              )}
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
              <input id="license-key" value={key} onChange={(e) => setKey(e.target.value)} required maxLength={64} autoComplete="off" spellCheck={false} aria-describedby="license-error" placeholder="License key" className={`${field} font-mono`} />
              <button type="submit" className={primary}>
                Use key
              </button>
            </form>
          </>
        )}
        <p role="status" className="mt-2 font-bold text-ink empty:hidden">
          {done}
        </p>
        <p id="license-error" role="alert" className="text-error empty:hidden">
          {error}
        </p>
      </DisclosureRow>
    </Group>
  );
}
