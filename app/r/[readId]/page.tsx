import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { AppShell } from "@/components/AppShell";
import { FeedAbout } from "@/components/FeedAbout";
import { NoteList } from "@/components/NoteList";
import { Removed } from "@/components/Removed";
import { getReadFeed, instanceTitle, isRemovedReadId, readPath, reportTemplate, rssPath } from "@/backend";
import { sortTags } from "@/shared/tags";

export const dynamic = "force-dynamic";

const readFeed = cache(getReadFeed); // the metadata and the page share one read per request

// Read-only and public even on a locked instance (proxy.ts skips /r/). Never render the feed name.
export async function generateMetadata({ params }: PageProps<"/r/[readId]">): Promise<Metadata> {
  const { readId } = await params;
  return {
    title: { absolute: (await readFeed(readId))?.title || instanceTitle() },
    alternates: { types: { "application/rss+xml": rssPath(readId) } },
  };
}

// Like the RSS route: a malformed id is a 404, an unknown one an empty feed.
export default async function ReadPage({ params, searchParams }: PageProps<"/r/[readId]">) {
  const { readId } = await params;
  const { tag: tagParam } = await searchParams;
  const tag = typeof tagParam === "string" ? tagParam.toLowerCase() : undefined;
  const data = tag ? await getReadFeed(readId, tag) : await readFeed(readId);
  if (!data) notFound();
  if (data.notes.length === 0 && (await isRemovedReadId(readId))) {
    return (
      <AppShell>
        <Removed />
      </AppShell>
    );
  }
  const { notes, title, description } = data;
  const all = tag ? await readFeed(readId) : data;
  const tags = sortTags((all ?? data).notes);

  return (
    <AppShell about={<FeedAbout title={title || instanceTitle()} description={description} imageUrl={data.imageUrl} rssUrl={rssPath(readId)} tags={tags} tag={tag} base={readPath(readId)} />}>
      {notes.length === 0 ? (
        <p className="text-muted">{tag ? "No notes with this tag." : "No notes yet."}</p>
      ) : (
        <NoteList notes={notes} base={readPath(readId)} imageBase={`${readPath(readId)}/`} report={reportTemplate() ? { template: reportTemplate(), readId } : undefined} />
      )}
    </AppShell>
  );
}
