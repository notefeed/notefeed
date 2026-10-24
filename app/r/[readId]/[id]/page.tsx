import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { NoteArticle } from "@/components/NoteList";
import { DamagedNote } from "@/components/DamagedNote";
import { Removed } from "@/components/Removed";
import { orDamaged } from "@/app/_lib/damaged";
import { getReadNote, getReadPictures, instanceTitle, isRemovedReadId, readPath, reportTemplate } from "@/backend";
import { attachmentLinks, kindOf } from "@/shared/notekinds";

export const dynamic = "force-dynamic";

// Never render the feed name here, not even in the title.
export const generateMetadata = (): Metadata => ({ title: { absolute: instanceTitle() } });

export default async function ReadNotePage({ params }: PageProps<"/r/[readId]/[id]">) {
  const { readId, id } = await params;
  const note = await orDamaged(getReadNote(readId, id));
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

  return (
    <AppShell>
      <NoteArticle
        note={note}
        back={readPath(readId)}
        imageBase={`${readPath(readId)}/`}
        report={reportTemplate() ? { template: reportTemplate(), readId } : undefined}
        link={kindOf(note.type).attachments(note.content).length ? attachmentLinks(await getReadPictures(readId), readPath(readId)) : undefined}
      />
    </AppShell>
  );
}
