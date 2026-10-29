import Link from "next/link";
import { card, sectionLabel } from "@/components/styles";
import { CardContent } from "@/components/NoteBody";
import { NoteCard } from "@/components/NoteCard";
import { Foot, type Report } from "@/components/NoteFoot";
import type { Note } from "@/backend";
import { UNREADABLE } from "@/app/_lib/messages";
import { RemovedMark } from "@/components/RemovedNote";
import { withoutAttachments } from "@/shared/notekinds";

// Times use the server's TZ (set TZ in compose.yaml).
const dayKey = (d: Date) => d.toLocaleDateString("en-CA");
const time = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

function dayLabel(d: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(d) === dayKey(today)) return "Today";
  if (dayKey(d) === dayKey(yesterday)) return "Yesterday";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

function groupByDay(notes: Note[]): [string, Note[]][] {
  const groups = new Map<string, Note[]>();
  for (const n of notes) {
    const label = dayLabel(n.date);
    groups.set(label, [...(groups.get(label) ?? []), n]);
  }
  return [...groups];
}

// image links point. The day label sticks below the phone's top bar (components/AppShell.tsx), at the top from lg.
// An attachment that a note in the list shows is left out (shared/notekinds.ts).
// `terms`: the instance has a terms page, which the operator's mark (#159) links to.
export function NoteList({ notes, base, imageBase, posted, report, terms }: { notes: Note[]; base: string; imageBase?: string; posted?: string; report?: Report; terms?: boolean }) {
  return groupByDay(withoutAttachments(notes)).map(([day, items]) => (
    <section key={day} aria-labelledby={`day-${dayKey(items[0].date)}`} className="mb-6">
      <h2 id={`day-${dayKey(items[0].date)}`} className={`${sectionLabel} sticky top-14 z-10 -mx-4 bg-paper/90 px-4 py-1.5 backdrop-blur-sm lg:top-0 lg:-mx-6 lg:px-6`}>
        {day}
      </h2>
      <ol className="mt-2 space-y-3">
        {items.map((n) => (
          <NoteCard key={n.id} className={`${card} p-4 ${n.id === posted ? "arrived" : ""}`}>
            {n.unreadable ? (
              // A damaged note, in its place: what happened, and its page (where its owner can delete it).
              <p role="status" className="text-muted">
                {UNREADABLE}{" "}
                <Link href={`${base}/${n.id}`} className="underline hover:text-carbon">
                  Open
                </Link>
              </p>
            ) : n.removed ? (
              // The operator's mark (#159), in the post's place; its page is where its owner can delete it.
              <RemovedMark terms={terms} />
            ) : (
              <CardContent note={n} imageBase={imageBase} />
            )}
            <Foot note={n} base={base} when={time(n.date)} open={`${base}/${n.id}`} report={n.removed ? undefined : report} />
          </NoteCard>
        ))}
      </ol>
    </section>
  ));
}
