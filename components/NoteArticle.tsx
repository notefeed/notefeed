import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { card } from "@/components/styles";
import { PageContent } from "@/components/NoteBody";
import { Foot, type Report } from "@/components/NoteFoot";
import type { Note } from "@/backend";

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
          <PageContent note={note} imageBase={imageBase} attachments={link} />
        </div>
        <Foot note={note} base={back} when={note.createdAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} report={report} />
      </article>
    </>
  );
}
