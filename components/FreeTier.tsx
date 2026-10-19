import Link from "next/link";
import { card } from "@/components/styles";

// A free feed's notes against the cap (issue #183), only on an instance that sells licenses: the owner learns before notes go.
export type FreeTierUsage = { notes: number; cap: number };

// From this share of the cap on, the feed's page says so.
const WARN_FROM = 0.9;

export const fullCap = ({ notes, cap }: FreeTierUsage) => notes >= cap;

/** "N of 1000 notes" as a bar, for the feed's settings. */
export function FreeTierBar({ usage }: { usage: FreeTierUsage }) {
  const shown = Math.min(usage.notes, usage.cap);
  return (
    <div
      role="meter"
      aria-label="Free notes used"
      aria-valuemin={0}
      aria-valuemax={usage.cap}
      aria-valuenow={shown}
      aria-valuetext={`${shown} of ${usage.cap} notes`}
      className="h-1.5 overflow-hidden rounded-full bg-surface-2"
    >
      <div className={`h-full rounded-full ${fullCap(usage) ? "bg-error" : "bg-carbon"}`} style={{ width: `${(shown / usage.cap) * 100}%` }} />
    </div>
  );
}

/** On the feed's page, for whoever can post to it, once the feed is near or at the cap. Never in RSS or on the read pages.
 *  `licensePage`: /license exists (ADR 0035), so the notice points to it. */
export function FreeTierNotice({ usage, licensePage }: { usage: FreeTierUsage | null; licensePage: boolean }) {
  if (!usage || usage.notes < usage.cap * WARN_FROM) return null;
  return (
    <section role="status" className={`${card} mb-4 p-4 text-sm`}>
      <p>
        {fullCap(usage)
          ? `This feed is at its ${usage.cap} free notes: each new note drops the oldest one.`
          : `This feed holds ${usage.notes} of its ${usage.cap} free notes. Past that, each new note drops the oldest one.`}
        {licensePage && (
          <>
            {" "}
            <Link href="/license" className="text-carbon underline">
              A license
            </Link>{" "}
            keeps them all.
          </>
        )}
      </p>
    </section>
  );
}
