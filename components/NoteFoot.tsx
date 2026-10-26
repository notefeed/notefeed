import Link from "next/link";
import { CalendarClock, Flag, Hash } from "lucide-react";
import { chip } from "@/components/styles";
import { isScheduled, type Note } from "@/backend";
import { reportUrl } from "@/shared/report";

// The foot of a note's card, one line: its tags, which link to the list filtered by that tag (`${base}?tag=…`), then who
// posted it, when, and the Report link. No header row: the title is the first thing in the card. `open`: in a list, the note's page,
// which its time links to (ADR 0040), named by the note's title for a screen reader.
// A note dated after now is scheduled: only its owner's pages get it, and its card says so first. These are server components,
// so "now" is the server's alone and nothing differs at hydration.
export function Foot({ note, base, when, open, report }: { note: Note; base: string; when: string; open?: string; report?: Report }) {
  const at = (
    <time dateTime={note.date.toISOString()} className="tabular-nums">
      {when}
    </time>
  );
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2">
      <div className="flex min-w-0 flex-1 flex-wrap gap-2">
        {isScheduled(note) && (
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-[13px] text-carbon">
            <CalendarClock aria-hidden className="h-3 w-3" />
            Scheduled for {fullDate(note.date)}
          </span>
        )}
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
        {open ? (
          <Link href={open} data-open aria-label={`${note.title || "Note"}, ${when}`} className="rounded-full hover:text-carbon hover:underline">
            {at}
          </Link>
        ) : (
          at
        )}
        <ReportLink note={note} report={report} />
      </div>
    </div>
  );
}

// A note's date and time, as its own page shows it. Times use the server's TZ (set TZ in compose.yaml).
export const fullDate = (d: Date) => d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

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

