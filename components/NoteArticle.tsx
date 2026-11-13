import Link from "next/link";
import { BackIcon } from "@/components/icons";
import { card } from "@/components/styles";
import { PageContent } from "@/components/NoteBody";
import { Foot, fullDate, type Report } from "@/components/NoteFoot";
import type { Note } from "@/backend";
import { serverCopy } from "@/app/_lib/copy";

// One note on its own page, as a card, under the way back to the list. `report` false: the page shows the Report link elsewhere (the note's action bar).
// `backInBar`: from lg the way back is in the note's action bar (components/NoteActions.tsx), not above the note, so the note
// and the right column start level, as on the feed's page.
// `backAside`: from xl the way back is a card in the right column (components/BackToFeed.tsx, #307), not above the note.
// `link`: the pages of the feed's attachments, which the note's attachments link to (shared/notekinds.ts).
export async function NoteArticle({
  note,
  back,
  imageBase,
  report,
  backInBar = false,
  backAside = false,
  link,
}: {
  note: Note;
  back: string;
  imageBase?: string;
  report?: Report;
  backInBar?: boolean;
  backAside?: boolean;
  link?: (src: string) => string | undefined;
}) {
  const t = await serverCopy();
  return (
    <>
      <Link
        href={back}
        aria-label={t.note.backToAll}
        className={`-ml-2 mb-3 h-7 items-center gap-1 rounded-full px-2 text-sm text-carbon hover:bg-surface-2 ${backInBar ? "inline-flex lg:hidden" : backAside ? "inline-flex xl:hidden" : "inline-flex"}`}
      >
        <BackIcon aria-hidden className="h-4 w-4" />
        {t.note.allNotes}
      </Link>
      <article className={`${card} p-4 sm:p-5`}>
        <div>
          <PageContent t={t} note={note} imageBase={imageBase} attachments={link} />
        </div>
        <Foot t={t} note={note} base={back} when={fullDate(t, note.date)} report={report} />
      </article>
    </>
  );
}
