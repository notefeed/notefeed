import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { BackToFeed } from "@/components/BackToFeed";
import { NoteArticle } from "@/components/NoteArticle";
import { DamagedNote } from "@/components/DamagedNote";
import { Removed } from "@/components/Removed";
import { orDamaged } from "@/app/_lib/damaged";
import { getReadFeedAbout, getReadNote, getReadPictures, instanceTitle, isRemovedReadId, readPath, reportTemplate } from "@/backend";
import { attachmentLinks, kindOf } from "@/shared/notekinds";

export const dynamic = "force-dynamic";

// Never render the feed name here, not even in the title.
export const generateMetadata = (): Metadata => ({ title: { absolute: instanceTitle() } });

export default async function ReadNotePage({ params }: PageProps<"/r/[readId]/[id]">) {
  const { readId, id } = await params;
  const asOf = new Date(); // one time for the note and its pictures' links: a scheduled note is a missing one until then
  const note = await orDamaged(getReadNote(readId, id, asOf));
  if (note === "damaged") {
    return (
      <AppShell>
        <DamagedNote id={id} back={readPath(readId)} />
      </AppShell>
    );
  }
  if (!note && (await isRemovedReadId(readId))) {
    return (
      <AppShell>
        <Removed />
      </AppShell>
    );
  }
  if (!note) notFound();

  const about = await getReadFeedAbout(readId);
  return (
    <AppShell about={<BackToFeed title={about.title || instanceTitle()} imageUrl={about.imageUrl} href={readPath(readId)} />} docked>
      <NoteArticle
        note={note}
        back={readPath(readId)}
        backAside
        imageBase={`${readPath(readId)}/`}
        report={reportTemplate() ? { template: reportTemplate(), readId } : undefined}
        link={kindOf(note.type).attachments(note.content).length ? attachmentLinks(await getReadPictures(readId, asOf), readPath(readId)) : undefined}
      />
    </AppShell>
  );
}
