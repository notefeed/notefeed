"use client";

import { LicenseIcon } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { messagesFor } from "@/app/_lib/messages";
import { useCopy } from "@/components/CopyProvider";
import { FreeTierBar, type FreeTierUsage } from "@/components/FreeTier";
import { DisclosureRow, Group } from "@/components/SettingsRows";
import { field, primary, secondary } from "@/components/styles";

// On a feed's settings page while the instance sells licenses (ADR 0029): the feed's tier (a free one with its notes against the cap,
// issue #183), a field for a key, and a way to take it off. `freeTier` is null for a licensed feed. `licensePage`: /license exists
// (ADR 0035), so the texts link to it.
export function LicenseSection({ feed, freeTier, licensePage }: { feed: string; freeTier: FreeTierUsage | null; licensePage: boolean }) {
  const licensed = freeTier === null;
  const all = useCopy();
  const t = all.licenseSection;
  const { errorMessage } = messagesFor(all);
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
      setDone(method === "POST" ? t.on : t.off);
      router.refresh();
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    setError(
      body.error && body.code === "invalid_body"
        ? `${body.error[0].toUpperCase()}${body.error.slice(1)}.`
        : (errorMessage(body.code) ?? all.errors.somethingWrong),
    );
  }

  return (
    <Group id="license" label={t.title}>
      <DisclosureRow
        icon={<LicenseIcon />}
        label={t.title}
        value={
          licensed ? (
            <span className="rounded-full bg-carbon-soft px-2 py-0.5 text-[12px] font-bold text-carbon">{t.licensed}</span>
          ) : (
            t.freeTier(Math.min(freeTier.notes, freeTier.cap), freeTier.cap)
          )
        }
      >
        {licensed ? (
          <>
            <p className="text-muted">
              {t.hasLicense}
              {licensePage && (
                <>
                  {" "}
                  {t.manageBefore}{" "}
                  <Link href="/license" className="text-carbon underline">
                    {t.managePage}
                  </Link>{" "}
                  {t.manageAfter}
                </>
              )}
            </p>
            <button type="button" onClick={() => send("DELETE")} className={`${secondary} mt-3`}>
              {t.takeOff}
            </button>
          </>
        ) : (
          <>
            <FreeTierBar t={all} usage={freeTier} />
            <p className="mt-3 text-muted">
              {t.freeIntro(freeTier.cap)}{" "}
              {licensePage ? (
                <>
                  <Link href="/license" className="text-carbon underline">
                    {t.buy}
                  </Link>
                  {t.thenEnter}
                </>
              ) : (
                t.enterToLift
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
                {t.key}
              </label>
              <input
                id="license-key"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                required
                maxLength={64}
                autoComplete="off"
                spellCheck={false}
                aria-describedby="license-error"
                placeholder={t.key}
                className={`${field} font-mono`}
              />
              <button type="submit" className={primary}>
                {t.use}
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
