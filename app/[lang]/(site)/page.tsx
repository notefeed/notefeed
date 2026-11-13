import { redirect } from "next/navigation";
import { PostIcon, ReadLinkIcon, RssIcon, WarningIcon } from "@/components/icons";
import { HomeFeeds } from "@/components/HomeFeeds";
import { card } from "@/components/styles";
import { OpenFeed } from "@/components/OpenFeed";
import { NoteView } from "@/components/NoteView";
import { checkFeed, feedPath, readNotice } from "@/backend";
import { normalizeFeedInput, suggestFeedName } from "@/app/_lib/names";
import { shareQuery } from "@/shared/share";
import { copyFor } from "@/shared/copy";
import { rich } from "@/components/rich";

export const dynamic = "force-dynamic";

export default async function Home({ params: route, searchParams }: PageProps<"/[lang]">) {
  const t = copyFor((await route).lang).home;
  const params = await searchParams;
  const { feed, deleted } = params;
  // Shared to notefeed from another app (the share target in app/manifest.ts): the feed that is picked gets it, in its compose box.
  const shareQ = shareQuery(params);
  const shared = [...new URLSearchParams(shareQ)];
  let error: string | undefined;
  if (typeof feed === "string") {
    const name = normalizeFeedInput(feed);
    const bad = checkFeed(name);
    if (!bad) redirect(feedPath(name) + shareQ);
    error = t[bad];
  }
  // The operator's own words for everyone who opens the instance (backend/legal.ts); notefeed ships none.
  const notice = await readNotice();

  return (
    <>
      {deleted && (
        <p role="status" className="mb-4 text-sm text-carbon">
          {t.feedDeleted}
        </p>
      )}
      {notice !== null && (
        <aside aria-label={t.notice} className="mb-8 rounded-2xl border border-l-4 border-error bg-error/10 px-4 py-3">
          <NoteView markdown={notice} />
        </aside>
      )}
      {shared.length > 0 && <HomeFeeds query={shareQ} label={t.postShared} />}
      <h1 className="text-3xl font-bold tracking-tight">{t.headline}</h1>
      <p className="mt-2 text-muted">{t.intro}</p>
      <p className="mb-6 mt-2 text-muted">
        {t.values}{" "}
        <a href="https://docs.notefeed.me/values/" className="text-ink underline hover:text-carbon">
          {t.valuesLink}
        </a>
        .
      </p>
      <section aria-labelledby="open-feed" className={`${card} mb-8 p-5`}>
        <h2 id="open-feed" className="mb-1 text-[17px] font-bold">
          {t.open}
        </h2>
        <div role="note" className="mb-4 mt-3 flex gap-3 rounded-xl border border-error/40 bg-error/5 p-3 text-sm">
          <WarningIcon aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-error" />
          <p className="text-ink">{rich(t.nameIsKey, { strong: "font-bold" })}</p>
        </div>
        <OpenFeed value={typeof feed === "string" ? feed : suggestFeedName()} error={error} carry={shared} />
      </section>
      {shared.length === 0 && <HomeFeeds />}
      <div className="grid gap-3 sm:grid-cols-3">
        {[<PostIcon key="post" />, <RssIcon key="rss" />, <ReadLinkIcon key="share" />]
          .map((icon, i) => ({ icon, ...t.features[i] }))
          .map((f) => (
            <div key={f.title} className={`${card} p-4`}>
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-carbon-soft text-carbon [&>svg]:h-[18px] [&>svg]:w-[18px]">
                {f.icon}
              </span>
              <h2 className="mt-3 text-[15px] font-bold">{f.title}</h2>
              <p className="mt-0.5 text-[13px] text-muted">{f.text}</p>
            </div>
          ))}
      </div>
    </>
  );
}
