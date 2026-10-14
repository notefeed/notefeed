import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { NoteArticle } from "@/components/NoteList";
import { NoteActions } from "@/components/NoteActions";
import { Removed } from "@/components/Removed";
import { UnlockForm } from "@/components/UnlockForm";
import { noteErrorMessage } from "@/app/_lib/messages";
import { reportUrl } from "@/shared/report";
import { feedCookieName, feedPath, feedUnlocked, getFeedNote, imageUploadsOn, isRemovedFeed, readIdOf, readPath, reportTemplate } from "@/backend";

export const dynamic = "force-dynamic";

export default async function NotePage({ params, searchParams }: PageProps<"/[feed]/[id]">) {
  const { feed, id } = await params;
  const { edited, error, retry } = await searchParams;
  if (await isRemovedFeed(feed)) {
    return (
      <AppShell feed={feed}>
        <Removed />
      </AppShell>
    );
  }
  if ((await feedUnlocked(feed, (await cookies()).get(feedCookieName(feed))?.value)) === "locked") {
    return (
      <AppShell feed={feed}>
        <UnlockForm feed={feed} />
      </AppShell>
    );
  }
  const note = await getFeedNote(feed, id);
  if (!note) notFound();
  const readId = await readIdOf(feed);
  const imageBase = readId ? `${readPath(readId)}/` : undefined;
  // The Report link goes in the note's action bar, not on the note.
  const reportHref = readId && reportTemplate() ? reportUrl(reportTemplate(), { readId, noteId: note.id, file: note.file }) : undefined;

  return (
    <AppShell feed={feed}>
      {edited === "1" && (
        <p role="status" className="mb-4 text-sm text-carbon">
          Saved.
        </p>
      )}
      <NoteArticle note={note} back={feedPath(feed)} imageBase={imageBase} />
      <NoteActions key={`${note.content}\n${note.meta.title}\n${note.alt}`} feed={feed} id={id} kind={note.type.startsWith("image/") ? "image" : "markdown"} markdown={note.content ?? ""} title={note.meta.title ?? ""} alt={note.alt ?? ""} error={noteErrorMessage(error, retry)} images={imageUploadsOn()} imageBase={imageBase} reportHref={reportHref} />
    </AppShell>
  );
}
