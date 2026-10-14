import { redirect } from "next/navigation";
import { Link2, Rss, Send } from "lucide-react";
import { HomeFeeds } from "@/components/HomeFeeds";
import { card } from "@/components/styles";
import { OpenFeed } from "@/components/OpenFeed";
import { NoteView } from "@/components/NoteView";
import { checkFeed, feedPath, readNotice } from "@/backend";
import { normalizeFeedInput, suggestFeedName } from "@/app/_lib/names";

export const dynamic = "force-dynamic";

const MESSAGES = {
  invalid: "Use 1–64 characters: a–z, 0–9, - and _.",
  reserved: "That name is reserved. Pick another.",
};

export default async function Home({ searchParams }: PageProps<"/">) {
  const { feed, deleted, share_title, share_text, share_url } = await searchParams;
  // Shared to notefeed from another app (the share target in app/manifest.ts): the feed that is picked gets it, in its compose box.
  const shared = Object.entries({ share_title, share_text, share_url }).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== "");
  const shareQuery = shared.length ? `?${new URLSearchParams(shared)}` : "";
  let error: string | undefined;
  if (typeof feed === "string") {
    const name = normalizeFeedInput(feed);
    const bad = checkFeed(name);
    if (!bad) redirect(feedPath(name) + shareQuery);
    error = MESSAGES[bad];
  }
  // The operator's own words for everyone who opens the instance (backend/legal.ts); notefeed ships none.
  const notice = await readNotice();

  return (
    <>
      {deleted && (
        <p role="status" className="mb-4 text-sm text-carbon">
          Feed deleted.
        </p>
      )}
      {notice !== null && (
        <aside aria-label="Notice" className="mb-8 rounded-2xl border border-l-4 border-error bg-error/10 px-4 py-3">
          <NoteView markdown={notice} />
        </aside>
      )}
      {shared.length > 0 && <HomeFeeds query={shareQuery} label="Post what you shared to" />}
      <h1 className="text-3xl font-bold tracking-tight">Notes in, RSS out.</h1>
      <p className="mb-6 mt-2 text-muted">
        A feed is a list of markdown notes with a name. Post to it from this page, your phone or one curl command, and
        follow it in any RSS reader through its read link, which shows the notes but not the name.
      </p>
      <section aria-labelledby="open-feed" className={`${card} mb-8 p-5`}>
        <h2 id="open-feed" className="mb-1 text-[17px] font-bold">
          Open or create a feed
        </h2>
        <p className="mb-4 text-sm text-muted">
          <strong className="font-bold text-ink">Anyone who knows a feed&apos;s name can read and post to it — pick one that&apos;s hard to guess.</strong>
        </p>
        <OpenFeed value={typeof feed === "string" ? feed : suggestFeedName()} error={error} carry={shared} />
      </section>
      {shared.length === 0 && <HomeFeeds />}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { icon: <Send />, title: "Post from anywhere", text: "This page, the share sheet of your phone, or one curl command." },
          { icon: <Rss />, title: "Follow with RSS", text: "Any reader works. No account, no app." },
          { icon: <Link2 />, title: "Share without the name", text: "The read link shows the notes and can't post." },
        ].map((f) => (
          <div key={f.title} className={`${card} p-4`}>
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-carbon-soft text-carbon [&>svg]:h-[18px] [&>svg]:w-[18px]">{f.icon}</span>
            <h2 className="mt-3 text-[15px] font-bold">{f.title}</h2>
            <p className="mt-0.5 text-[13px] text-muted">{f.text}</p>
          </div>
        ))}
      </div>
    </>
  );
}
