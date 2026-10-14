import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { NoteArticle } from "@/components/NoteList";
import { Removed } from "@/components/Removed";
import { getReadNote, instanceTitle, isRemovedReadId, readPath, reportTemplate } from "@/backend";

export const dynamic = "force-dynamic";

// Never render the feed name here, not even in the title.
export const generateMetadata = (): Metadata => ({ title: { absolute: instanceTitle() } });

export default async function ReadNotePage({ params }: PageProps<"/r/[readId]/[id]">) {
  const { readId, id } = await params;
  const note = await getReadNote(readId, id);
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
      <NoteArticle note={note} back={readPath(readId)} imageBase={`${readPath(readId)}/`} report={reportTemplate() ? { template: reportTemplate(), readId } : undefined} />
    </AppShell>
  );
}
