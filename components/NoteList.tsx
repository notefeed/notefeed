import Link from "next/link";
import { ChevronLeft, Flag, Hash } from "lucide-react";
import { card, chip, sectionLabel } from "@/components/styles";
import { BODIES } from "@/components/NoteBody";
import type { Note } from "@/backend";
import { reportUrl } from "@/shared/report";
import { UNREADABLE } from "@/app/_lib/messages";
import { attachmentLinks, kindOf, withoutAttachments } from "@/shared/notekinds";

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

// Where a click on a note goes is decided here, the same for every kind (ADR 0038): in a list, everything on a note's card opens
// that note, its attachments too; on a note's own page, an attachment opens the attachment's own page.
function Card({ note, open, imageBase, attachments }: { note: Note; open: string; imageBase?: string; attachments: (src: string) => string | undefined }) {
  const body = BODIES[kindOf(note.type).name];
  const heading = body.heading(note, "card");
  return (
    <>
      {heading && (
        <Link href={open} className="block text-[17px] font-bold tracking-tight hover:text-carbon">
          {heading}
        </Link>
      )}
      <body.Content note={note} place="card" imageBase={imageBase} open={open} attachmentLink={(src) => (attachments(src) ? open : undefined)} />
    </>
  );
}

function Page({ note, imageBase, attachments }: { note: Note; imageBase?: string; attachments?: (src: string) => string | undefined }) {
  const body = BODIES[kindOf(note.type).name];
  const heading = body.heading(note, "page");
  return (
    <>
      {heading && <h1 className="mb-2 text-xl font-bold tracking-tight">{heading}</h1>}
      <body.Content note={note} place="page" imageBase={imageBase} attachmentLink={attachments} />
    </>
  );
}

// Notes as cards, grouped by day under sticky labels; each title links to `${base}/${id}`. `imageBase` is where a note's relative
// image links point. The day label sticks below the phone's top bar (components/AppShell.tsx), at the top from lg.
// An attachment that a note in the list shows is left out (shared/notekinds.ts).
export function NoteList({ notes, base, imageBase, posted, report }: { notes: Note[]; base: string; imageBase?: string; posted?: string; report?: Report }) {
  const link = attachmentLinks(notes, base);
  return groupByDay(withoutAttachments(notes)).map(([day, items]) => (
    <section key={day} aria-labelledby={`day-${dayKey(items[0].createdAt)}`} className="mb-6">
      <h2 id={`day-${dayKey(items[0].createdAt)}`} className={`${sectionLabel} sticky top-14 z-10 -mx-4 bg-paper/90 px-4 py-1.5 backdrop-blur-sm lg:top-0 lg:-mx-6 lg:px-6`}>
        {day}
      </h2>
      <ol className="mt-2 space-y-3">
        {items.map((n) => (
          <li key={n.id} className={`${card} p-4 ${n.id === posted ? "arrived" : ""}`}>
            {n.unreadable ? (
              // A damaged note, in its place: what happened, and its page (where its owner can delete it).
              <p role="status" className="text-muted">
                {UNREADABLE}{" "}
                <Link href={`${base}/${n.id}`} className="underline hover:text-carbon">
                  Open
                </Link>
              </p>
            ) : (
              <Card note={n} open={`${base}/${n.id}`} imageBase={imageBase} attachments={link} />
            )}
            <Foot note={n} base={base} when={time(n.createdAt)} report={report} />
          </li>
        ))}
      </ol>
    </section>
  ));
}

// One note on its own page, as a card, under the way back to the list. `report` false: the page shows the Report link elsewhere (the note's action bar).
// `backInBar`: from lg the way back is in the note's action bar (components/NoteActions.tsx), not above the note, so the note
// and the right column start level, as on the feed's page.
// `link`: the pages of the feed's attachments, which the note's attachments link to (shared/notekinds.ts).
export function NoteArticle({ note, back, imageBase, report, backInBar = false, link }: { note: Note; back: string; imageBase?: string; report?: Report; backInBar?: boolean; link?: (src: string) => string | undefined }) {
  return (
    <>
      <Link href={back} aria-label="Back to all notes" className={`-ml-2 mb-3 h-7 items-center gap-1 rounded-full px-2 text-sm text-carbon hover:bg-surface-2 ${backInBar ? "inline-flex lg:hidden" : "inline-flex"}`}>
        <ChevronLeft aria-hidden className="h-4 w-4" />
        All notes
      </Link>
      <article className={`${card} p-4 sm:p-5`}>
        <div>
          <Page note={note} imageBase={imageBase} attachments={link} />
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
