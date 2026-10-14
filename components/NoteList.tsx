import Link from "next/link";
import { ChevronLeft, Flag, Hash } from "lucide-react";
import { card, chip, sectionLabel } from "@/components/styles";
import { NoteView } from "@/components/NoteView";
import type { Note } from "@/backend";
import { bodyAfterTitle } from "@/shared/notes";
import { reportUrl } from "@/shared/report";

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
    const label = dayLabel(n.createdAt);
    groups.set(label, [...(groups.get(label) ?? []), n]);
  }
  return [...groups];
}

// The foot of a note's card, one line: its tags, which link to the list filtered by that tag (`${base}?tag=…`), then who
// posted it, when, and the Report link. No header row: the title is the first thing in the card.
function Foot({ note, base, when, report }: { note: Note; base: string; when: string; report?: Report }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2">
      <div className="flex min-w-0 flex-1 flex-wrap gap-2">
        {note.tags.map((t) => (
          <Link key={t} href={`${base}?tag=${encodeURIComponent(t)}`} className={chip}>
            <Hash aria-hidden className="h-3 w-3" />
            {t}
          </Link>
        ))}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1.5 text-[13px] text-muted">
        {note.sender && (
          <>
            <span className="max-w-32 truncate">{note.sender}</span>
            <span aria-hidden>·</span>
          </>
        )}
        <time dateTime={note.createdAt.toISOString()} className="tabular-nums">
          {when}
        </time>
        <ReportLink note={note} report={report} />
      </div>
    </div>
  );
}

// Where a reader reports a note (issue #154): the operator's URL template with the read id, never the feed name, so the link is the
// same on the feed page and in the read-only view. `report` is unset while the instance has no template, or the feed no read link.
export type Report = { template: string; readId: string };
function ReportLink({ note, report }: { note: Note; report?: Report }) {
  if (!report) return null;
  return (
    <a href={reportUrl(report.template, { readId: report.readId, noteId: note.id, file: note.file })} rel="nofollow noopener" className="ml-1 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[13px] text-muted hover:bg-surface-2 hover:text-carbon">
      <Flag aria-hidden className="h-3.5 w-3.5" />
      Report
    </a>
  );
}

// An image note's picture, from the feed's current read link (`imageBase`), so it follows a changed read id. The text alternative is
// the note's own, else its title, else none: a picture without a description is decoration to a screen reader, not a file name.
function Picture({ note, imageBase, className }: { note: Note; imageBase?: string; className: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={(imageBase ?? "") + note.file} alt={note.alt ?? note.title} loading="lazy" className={className} />;
}

// Notes as cards, grouped by day under sticky labels; each title links to `${base}/${id}`. `imageBase` is where a note's relative
// image links point. The day label sticks below the phone's top bar (components/AppShell.tsx), at the top from lg.
export function NoteList({ notes, base, imageBase, posted, report }: { notes: Note[]; base: string; imageBase?: string; posted?: string; report?: Report }) {
  return groupByDay(notes).map(([day, items]) => (
    <section key={day} aria-labelledby={`day-${dayKey(items[0].createdAt)}`} className="mb-6">
      <h2 id={`day-${dayKey(items[0].createdAt)}`} className={`${sectionLabel} sticky top-14 z-10 -mx-4 bg-paper/90 px-4 py-1.5 backdrop-blur-sm lg:top-0 lg:-mx-6 lg:px-6`}>
        {day}
      </h2>
      <ol className="mt-2 space-y-3">
        {items.map((n) => (
          <li key={n.id} className={`${card} p-4 ${n.id === posted ? "arrived" : ""}`}>
            {n.type.startsWith("image/") ? (
              <>
                {n.title && (
                  <Link href={`${base}/${n.id}`} className="mb-3 block text-[17px] font-bold tracking-tight hover:text-carbon">
                    {n.title}
                  </Link>
                )}
                <Link href={`${base}/${n.id}`} className="block">
                  <Picture note={n} imageBase={imageBase} className="max-h-96 w-full rounded-xl object-cover" />
                </Link>
              </>
            ) : (
              <Link href={`${base}/${n.id}`} className="block text-[17px] font-bold tracking-tight hover:text-carbon">
                {n.title || n.id}
              </Link>
            )}
            {bodyAfterTitle(n.content ?? "") && (
              <div className="mt-1 text-[15px]">
                <NoteView markdown={bodyAfterTitle(n.content ?? "")} imageBase={imageBase} />
              </div>
            )}
            <Foot note={n} base={base} when={time(n.createdAt)} report={report} />
          </li>
        ))}
      </ol>
    </section>
  ));
}

// One note on its own page, as a card, under the way back to the list. `report` false: the page shows the Report link elsewhere (the note's action bar).
export function NoteArticle({ note, back, imageBase, report }: { note: Note; back: string; imageBase?: string; report?: Report }) {
  return (
    <>
      <Link href={back} aria-label="Back to all notes" className="-ml-2 mb-3 inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm text-carbon hover:bg-surface-2">
        <ChevronLeft aria-hidden className="h-4 w-4" />
        All notes
      </Link>
      <article className={`${card} p-4 sm:p-5`}>
        <div>
          {note.type.startsWith("image/") ? (
            <>
              {note.title && <h1 className="mb-2 text-xl font-bold tracking-tight">{note.title}</h1>}
              <Picture note={note} imageBase={imageBase} className="max-w-full rounded-xl" />
            </>
          ) : (
            <NoteView markdown={(note.content ?? "")} imageBase={imageBase} />
          )}
        </div>
        <Foot note={note} base={back} when={note.createdAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} report={report} />
      </article>
    </>
  );
}

// Shown above a filtered list: what it is filtered by, and the way back to all notes.
export function TagFilter({ tag, base }: { tag: string; base: string }) {
  return (
    <p className="mb-4 text-sm text-muted">
      Notes tagged <span className="font-mono text-ink">{tag}</span> ·{" "}
      <Link href={base} className="text-carbon hover:underline">
        Show all notes
      </Link>
    </p>
  );
}
