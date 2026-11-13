import Link from "next/link";
import { card } from "@/components/styles";
import type { Copy } from "@/shared/copy";

// A free feed's notes against the cap (issue #183), only on an instance that sells licenses: the owner learns before notes go.
export type FreeTierUsage = { notes: number; cap: number };

// From this share of the cap on, the feed's page says so.
const WARN_FROM = 0.9;

export const fullCap = ({ notes, cap }: FreeTierUsage) => notes >= cap;

/** "N of 1000 notes" as a bar, for the feed's settings. */
export function FreeTierBar({ t, usage }: { t: Copy; usage: FreeTierUsage }) {
  const shown = Math.min(usage.notes, usage.cap);
  return (
    <div
      role="meter"
      aria-label={t.freeTier.meter}
      aria-valuemin={0}
      aria-valuemax={usage.cap}
      aria-valuenow={shown}
      aria-valuetext={t.freeTier.meterValue(shown, usage.cap)}
      className="h-1.5 overflow-hidden rounded-full bg-surface-2"
    >
      <div className={`h-full rounded-full ${fullCap(usage) ? "bg-error" : "bg-carbon"}`} style={{ width: `${(shown / usage.cap) * 100}%` }} />
    </div>
  );
}

/** On the feed's page, for whoever can post to it, once the feed is near or at the cap. Never in RSS or on the read pages.
 *  `licensePage`: /license exists (ADR 0035), so the notice points to it. */
export function FreeTierNotice({ t, usage, licensePage }: { t: Copy; usage: FreeTierUsage | null; licensePage: boolean }) {
  if (!usage || usage.notes < usage.cap * WARN_FROM) return null;
  return (
    <section role="status" className={`${card} mb-4 p-4 text-sm`}>
      <p>
        {fullCap(usage) ? t.freeTier.full(usage.cap) : t.freeTier.near(usage.notes, usage.cap)}
        {licensePage && (
          <>
            {" "}
            <Link href="/license" className="text-carbon underline">
              {t.freeTier.license}
            </Link>{" "}
            {t.freeTier.keepsAll}
          </>
        )}
      </p>
    </section>
  );
}
