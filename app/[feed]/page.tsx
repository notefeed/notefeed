import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { notFound } from "next/navigation";
import { Compose } from "@/components/Compose";
import { AppShell } from "@/components/AppShell";
import { FeedAbout } from "@/components/FeedAbout";
import { FreeTierNotice } from "@/components/FreeTier";
import { RememberFeed } from "@/components/RememberedFeeds";
import { card } from "@/components/styles";
import { NoteList, TagFilter } from "@/components/NoteList";
import { ProtectFeed } from "@/components/ProtectFeed";
import { Removed } from "@/components/Removed";
import { UnlockForm } from "@/components/UnlockForm";
import { curlFor } from "@/app/_lib/curl";
import { errorMessage, feedErrorMessage } from "@/app/_lib/messages";
import { checkFeed, feedCookieName, feedPath, feedUnlocked, freeTier, getFeed, IDENTITY_COOKIE, identitySender, imageUploadsOn, isRemovedFeed, licensePageOn, licensingOn, measured, publicUrl, readPath, reportTemplate, rssPath, settingsPath } from "@/backend";

export const dynamic = "force-dynamic";

// The metadata and the page share one read per request (the metadata reads it unfiltered). The read is what is measured (kind
// feed_page, feed_page_tag with a tag filter). Without a tag, whichever of the two runs first carries the time and the disk work; with
// one, the metadata's unfiltered read is a feed_page sample of its own and the filtered read a feed_page_tag one.
const loaded = (feed: string, tag?: string) => measured(tag ? "feed_page_tag" : "feed_page", () => getFeed(feed, tag), (data) => (data ? 200 : 404));
const feedData = cache((feed: string) => loaded(feed));
// The "Report" link needs the template and the feed's read id (a feed without a read link has no link; it has no notes either).
const report = (readId: string | null) => (readId && reportTemplate() ? { template: reportTemplate(), readId } : undefined);

export async function generateMetadata({ params }: PageProps<"/[feed]">): Promise<Metadata> {
  const { feed } = await params;
  if (checkFeed(feed)) return {};
  // A locked feed shows nothing of itself, not even its title.
  const access = await feedUnlocked(feed, (await cookies()).get(feedCookieName(feed))?.value);
  return { title: access === "locked" ? feed : ((await feedData(feed))?.title || feed) };
}

// The tags of the notes on the page, most used first: the filter in the feed's details.
const tagsOf = (notes: { tags: string[] }[]) => {
  const counts = new Map<string, number>();
  for (const n of notes) for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([t]) => t);
};
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function FeedPage({ params, searchParams }: PageProps<"/[feed]">) {
  const { feed } = await params;
  const { posted, deleted, error, retry, tag: tagParam, share_title, share_text, share_url } = await searchParams;
  const tag = typeof tagParam === "string" ? tagParam.toLowerCase() : undefined;
  if (!checkFeed(feed) && (await isRemovedFeed(feed))) {
    return (
      <AppShell feed={feed}>
        <Removed />
      </AppShell>
    );
  }
  const jar = await cookies();
  const access = await feedUnlocked(feed, jar.get(feedCookieName(feed))?.value);
  // A locked feed shows nothing of itself: no notes, no read link.
  if (access === "locked") {
    return (
      <AppShell feed={feed}>
        <UnlockForm feed={feed} error={feedErrorMessage(error, retry)} />
      </AppShell>
    );
  }
  const all = await feedData(feed);
  const data = tag ? await loaded(feed, tag) : all;
  if (!data || !all) notFound();
  const { notes, readId, exists, title, description } = data;
  const base = publicUrl(await headers());
  const readUrl = readId ? base + readPath(readId) : undefined; // none until the feed has a note
  const curlExample = curlFor(base, feed, access === "unlocked");
  // What another app shared to notefeed (app/share): the text and the link go into the note.
  const shared = [one(share_text), one(share_url)].filter(Boolean).join("\n\n");
  const isNew = access === "open" && !exists;
  const licensePage = await licensePageOn(); // the links to /license (ADR 0035)

  return (
    <AppShell
      feed={feed}
      about={
        <FeedAbout
          name={feed}
          title={title}
          description={description}
          imageUrl={data.imageUrl}
          readUrl={readUrl}
          rssUrl={readId ? base + rssPath(readId) : undefined}
          viewHref={readId ? readPath(readId) : undefined}
          settingsHref={exists ? settingsPath(feed) : undefined}
          tags={tagsOf(all.notes)}
          tag={tag}
          base={feedPath(feed)}
        >
          {isNew && <ProtectFeed licensing={licensingOn()} licensePage={licensePage} />}
        </FeedAbout>
      }
    >
      {exists && <RememberFeed feed={{ name: feed, title, image: data.imageUrl }} />}
      {exists && <FreeTierNotice usage={await freeTier(feed)} licensePage={licensePage} />}
      {deleted && (
        <p role="status" className="mb-4 text-sm text-carbon">
          Note deleted.
        </p>
      )}
      <Compose key={String(posted)} feed={feed} action={feedPath(feed)} error={errorMessage(error, retry)} errorCode={one(error)}
        isNew={isNew} settingsHref={exists ? settingsPath(feed) : undefined} licensePage={licensePage}
        sender={identitySender(jar.get(IDENTITY_COOKIE)?.value) !== undefined} images={imageUploadsOn()} imageBase={readId ? `${readPath(readId)}/` : undefined}
        initialTitle={one(share_title)} initialText={shared}
      />
      {tag && <TagFilter tag={tag} base={feedPath(feed)} />}
      {tag && notes.length === 0 ? (
        <p className="text-muted">No notes with this tag.</p>
      ) : notes.length === 0 ? (
        <section className={`${card} p-5 text-center text-muted`}>
          <p>No notes yet. Write one, or post from a script:</p>
          <pre className="mt-3 overflow-x-auto rounded-xl bg-surface-2 p-3 text-left font-mono text-sm text-ink">{curlExample}</pre>
        </section>
      ) : (
        <NoteList notes={notes} base={feedPath(feed)} imageBase={readId ? `${readPath(readId)}/` : undefined} posted={typeof posted === "string" ? posted : undefined} report={report(readId)} />
      )}
    </AppShell>
  );
}
