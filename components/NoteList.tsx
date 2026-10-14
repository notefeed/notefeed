import Link from "next/link";
import { Flag, Hash, NotebookText } from "lucide-react";
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

// The foot of a note's card: its tags, which link to the list filtered by that tag (`${base}?tag=…`), and the Report link.
function Foot({ note, base, report }: { note: Note; base: string; report?: Report }) {
  if (!note.tags.length && !report) return null;
  return (
    <div className="mt-3 flex items-end gap-2">
      <div className="flex min-w-0 flex-1 flex-wrap gap-2">
        {note.tags.map((t) => (
          <Link key={t} href={`${base}?tag=${encodeURIComponent(t)}`} className={chip}>
            <Hash aria-hidden className="h-3 w-3" />
            {t}
          </Link>
        ))}
      </div>
      <ReportLink note={note} report={report} />
    </div>
  );
}

// Where a reader reports a note (issue #154): the operator's URL template with the read id, never the feed name, so the link is the
// same on the feed page and in the read-only view. `report` is unset while the instance has no template, or the feed no read link.
export type Report = { template: string; readId: string };
function ReportLink({ note, report }: { note: Note; report?: Report }) {
  if (!report) return null;
  return (
    <a href={reportUrl(report.template, { readId: report.readId, noteId: note.id, file: note.file })} rel="nofollow noopener" className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[13px] text-muted hover:bg-surface-2 hover:text-carbon">
      <Flag aria-hidden className="h-3.5 w-3.5" />
      Report
    </a>
  );
}

// The head of a note's card: who posted it (the sender's initial; a note icon when the feed doesn't show senders) and when.
function Byline({ note, when }: { note: Note; when: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span aria-hidden className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-carbon-soft text-[13px] font-bold uppercase text-carbon">
        {note.sender ? note.sender[0] : <NotebookText className="h-4 w-4" />}
      </span>
      <div className="min-w-0 flex-1 text-[13px] leading-tight">
        {note.sender && <p className="truncate font-bold">{note.sender}</p>}
        <time dateTime={note.createdAt.toISOString()} className="tabular-nums text-muted">
          {when}
        </time>
      </div>
    </div>
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
            <Byline note={n} when={time(n.createdAt)} />
            {n.type.startsWith("image/") ? (
              <>
                {n.title && (
                  <Link href={`${base}/${n.id}`} className="mt-3 block text-[17px] font-bold tracking-tight hover:text-carbon">
                    {n.title}
                  </Link>
                )}
                <Link href={`${base}/${n.id}`} className="mt-3 block">
                  <Picture note={n} imageBase={imageBase} className="max-h-96 w-full rounded-xl object-cover" />
                </Link>
              </>
            ) : (
              <Link href={`${base}/${n.id}`} className="mt-3 block text-[17px] font-bold tracking-tight hover:text-carbon">
                {n.title || n.id}
              </Link>
            )}
            {bodyAfterTitle(n.content ?? "") && (
              <div className="mt-1 text-[15px]">
                <NoteView markdown={bodyAfterTitle(n.content ?? "")} imageBase={imageBase} />
              </div>
            )}
            <Foot note={n} base={base} report={report} />
          </li>
        ))}
      </ol>
    </section>
  ));
}

// One note on its own page, as a card. `report` false: the page shows the Report link elsewhere (the note's action bar).
export function NoteArticle({ note, back, imageBase, report }: { note: Note; back: string; imageBase?: string; report?: Report }) {
  return (
    <>
      <article className={`${card} p-4 sm:p-5`}>
        <Byline note={note} when={note.createdAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} />
        <div className="mt-3">
          {note.type.startsWith("image/") ? (
            <>
              {note.title && <h1 className="mb-2 text-xl font-bold tracking-tight">{note.title}</h1>}
              <Picture note={note} imageBase={imageBase} className="max-w-full rounded-xl" />
            </>
          ) : (
            <NoteView markdown={(note.content ?? "")} imageBase={imageBase} />
          )}
        </div>
        <Foot note={note} base={back} report={report} />
      </article>
      <p className="mt-6 text-center text-sm">
        <Link href={back} className="text-carbon hover:underline">
          Back to all notes
        </Link>
      </p>
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
