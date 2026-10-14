import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Link2, Rss, Terminal } from "lucide-react";
import { curlFor } from "@/app/_lib/curl";
import { feedDetailsErrorMessage, feedErrorMessage } from "@/app/_lib/messages";
import { CopyButton } from "@/components/CopyButton";
import { FeedDetails } from "@/components/FeedDetails";
import { FeedSettings } from "@/components/FeedSettings";
import { LicenseSection } from "@/components/LicenseSection";
import { AppShell } from "@/components/AppShell";
import { FeedAbout } from "@/components/FeedAbout";
import { RememberFeed } from "@/components/RememberedFeeds";
import { DisclosureRow, Row } from "@/components/SettingsRows";
import { iconButton } from "@/components/styles";
import { checkFeed, feedCookieName, feedPath, feedUnlocked, customIdsOn, getFeed, getFeedImages, identityOn, isLicensed, isReservedFeed, licensingOn, publicUrl, readPath, rssPath } from "@/backend";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Feed settings" };

export default async function SettingsPage({ params, searchParams }: PageProps<"/[feed]/settings">) {
  const { feed } = await params;
  const { saved, error, retry, form } = await searchParams;
  if (checkFeed(feed)) notFound();
  const access = await feedUnlocked(feed, (await cookies()).get(feedCookieName(feed))?.value);
  const data = access === "locked" ? null : await getFeed(feed);
  // Locked feeds show only the unlock form on the feed page, and a feed without notes has nothing to set yet.
  if (!data?.exists) redirect(feedPath(feed));
  const { readId, title, description } = data;
  const images = await getFeedImages(feed);
  const base = publicUrl(await headers());
  const readUrl = readId ? base + readPath(readId) : undefined;
  const rssUrl = readId ? base + rssPath(readId) : undefined;
  const detailsError = form === "details";
  const passwordError = !detailsError && access === "unlocked" && ["auth", "invalid_body", "too_many_attempts"].includes(String(error));

  return (
    <AppShell
      feed={feed}
      about={<FeedAbout name={feed} title={title} description={description} imageUrl={data.imageUrl} readUrl={readId ? base + readPath(readId) : undefined} rssUrl={rssUrl} viewHref={readId ? readPath(readId) : undefined} base={feedPath(feed)} />}
    >
      <RememberFeed feed={{ name: feed, title, image: data.imageUrl }} />
      <div className="mb-5 flex items-center gap-2">
        <Link href={feedPath(feed)} className={iconButton} aria-label="Back to the feed" title="Back to the feed">
          <ChevronLeft aria-hidden className="h-5 w-5" />
        </Link>
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
      </div>
      {saved && (
        <p role="status" className="mb-4 text-sm text-carbon">
          Saved.
        </p>
      )}
      <FeedDetails
        key={`${title}\n${description}\n${data.image}\n${data.showSender}\n${readId}\n${images.map((i) => i.file)}`}
        feed={feed}
        title={title}
        description={description}
        image={data.image}
        imageUrl={data.imageUrl}
        images={images}
        showSender={data.showSender}
        readId={readId}
        readIdChoice={isReservedFeed(feed) ? "fixed" : customIdsOn() ? "custom" : "random"}
        identity={identityOn()}
        error={detailsError ? feedDetailsErrorMessage(error, retry) : undefined}
        sharing={
          <>
            {readUrl ? (
              <>
                <div>
                  <Row icon={<Link2 />} label="Read link" hint="For sharing: shows the notes, not this feed's name, and can't post.">
                    <CopyButton text={readUrl} compact label="Copy read link" />
                  </Row>
                  <code className="-mt-1 block break-all px-4 pb-3 pl-[3.75rem] font-mono text-[13px] text-carbon">{readUrl}</code>
                </div>
                <Row icon={<Rss />} label="RSS feed" hint={<code className="break-all font-mono">{rssUrl}</code>}>
                  <CopyButton text={rssUrl!} compact label="Copy RSS link" />
                </Row>
              </>
            ) : (
              <Row icon={<Link2 />} label="Read link" hint="Appears after the first note." />
            )}
            <DisclosureRow icon={<Terminal />} label="Post from a script">
              <pre className="overflow-x-auto rounded-xl bg-surface-2 p-3 font-mono text-[13px] text-ink">{curlFor(base, feed, access === "unlocked")}</pre>
            </DisclosureRow>
          </>
        }
      >
        {licensingOn() && <LicenseSection feed={feed} licensed={await isLicensed(feed)} />}
        {access === "unlocked" && <FeedSettings feed={feed} error={passwordError ? feedErrorMessage(error, retry) : undefined} />}
      </FeedDetails>
    </AppShell>
  );
}
