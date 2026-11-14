"use client";

import { LicenseIcon } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { messagesFor } from "@/app/_lib/messages";
import { useCopy } from "@/components/CopyProvider";
import { FreeTierBar, type FreeTierUsage } from "@/components/FreeTier";
import { DisclosureRow, Group } from "@/components/SettingsRows";
import { primary, secondary } from "@/components/styles";

// On a feed's settings page while the instance sells licenses (ADR 0029, ADR 0061): the feed's tier (a free one with its notes against
// the cap, issue #183), and, for the feed's owner, a way to put it under the account's license or take it off. `freeTier` is null for a
// licensed feed. `yours`: the signed-in account owns the feed; anyone else is told that a license is an account's. `licensePage`:
// /license exists (ADR 0035), so the texts link to it.
export function LicenseSection({ feed, freeTier, licensePage, yours }: { feed: string; freeTier: FreeTierUsage | null; licensePage: boolean; yours: boolean }) {
  const licensed = freeTier === null;
  const all = useCopy();
  const t = all.licenseSection;
  const { errorMessage } = messagesFor(all);
  const router = useRouter();
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  async function send(method: "PUT" | "DELETE") {
    setError("");
    setDone("");
    const res = await fetch(`/api/v1/feeds/${encodeURIComponent(feed)}/license`, { method }).catch(() => null);
    if (res?.ok) {
      setDone(method === "PUT" ? t.on : t.off);
      router.refresh();
      return;
    }
    const body = (await res?.json().catch(() => ({}))) as { code?: string } | undefined;
    setError(errorMessage(body?.code) ?? all.errors.somethingWrong);
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
              {t.hasLicense}{" "}
              <Link href="/account" className="text-carbon underline">
                {t.manage}
              </Link>
            </p>
            {yours && (
              <button type="button" onClick={() => send("DELETE")} className={`${secondary} mt-3`}>
                {t.takeOff}
              </button>
            )}
          </>
        ) : (
          <>
            <FreeTierBar t={all} usage={freeTier} />
            <p className="mt-3 text-muted">
              {t.freeIntro(freeTier.cap)} {yours ? t.yoursIntro : t.notYours}{" "}
              {licensePage && (
                <Link href="/license" className="text-carbon underline">
                  {t.buy}
                </Link>
              )}
            </p>
            {yours && (
              <button type="button" onClick={() => send("PUT")} className={`${primary} mt-3`}>
                {t.putOn}
              </button>
            )}
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
