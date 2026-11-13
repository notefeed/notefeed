import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { AgentIcon, ApiIcon, BackIcon, CodeIcon, ExternalIcon, PhoneIcon, ReadLinkIcon, RssIcon, ScriptIcon } from "@/components/icons";
import { claudeMcpFor, curlFor } from "@/app/_lib/curl";
import { feedDetailsErrorMessage, feedErrorMessage, passwordNotice, protectErrorMessage, recoverErrorMessage } from "@/app/_lib/messages";
import { CopyButton } from "@/components/CopyButton";
import { FeedDetails } from "@/components/FeedDetails";
import { FeedSettings, ProtectFeed } from "@/components/FeedSettings";
import { LicenseSection } from "@/components/LicenseSection";
import { AppShell } from "@/components/AppShell";
import { FeedAbout } from "@/components/FeedAbout";
import { RememberFeed } from "@/components/RememberedFeeds";
import { DisclosureRow, Row } from "@/components/SettingsRows";
import { iconButton } from "@/components/styles";
import {
  checkFeed,
  feedCookieName,
  feedPath,
  feedUnlocked,
  locked,
  customIdsOn,
  getFeed,
  getFeedImages,
  freeTier,
  identityOn,
  isReservedFeed,
  licensePageOn,
  licensingOn,
  publicUrl,
  readPath,
  rssPath,
  atomPath,
  SHORTCUT_PATH,
} from "@/backend";
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
  const atomUrl = readId ? base + atomPath(readId) : undefined;
  const detailsError = form === "details";
  const recoverForm = form === "recover";
  const passwordError = !detailsError && !recoverForm && access === "unlocked" && ["auth", "invalid_body", "too_many_attempts"].includes(String(error));

  return (
    <AppShell
      feed={feed}
      about={
        <FeedAbout
          name={feed}
          title={title}
          description={description}
          imageUrl={data.imageUrl}
          readUrl={readId ? base + readPath(readId) : undefined}
          rssUrl={rssUrl}
          viewHref={readId ? readPath(readId) : undefined}
          base={feedPath(feed)}
        />
      }
    >
      <RememberFeed feed={{ name: feed, title, image: data.imageUrl }} />
      <div className="mb-5 flex items-center gap-2">
        <Link href={feedPath(feed)} className={iconButton} aria-label="Back to the feed" title="Back to the feed">
          <BackIcon aria-hidden className="h-5 w-5" />
        </Link>
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
      </div>
      {saved === "1" && (
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
        renamable={!isReservedFeed(feed)}
        error={detailsError ? feedDetailsErrorMessage(error, retry) : undefined}
        sharing={
          <>
            {readUrl ? (
              <>
                <div>
                  <Row icon={<ReadLinkIcon />} label="Read link" hint="For sharing: shows the notes, not this feed's name, and can't post.">
                    <CopyButton text={readUrl} compact label="Copy read link" />
                  </Row>
                  <code className="-mt-1 block break-all px-4 pb-3 pl-[3.75rem] font-mono text-[13px] text-carbon">{readUrl}</code>
                </div>
                <Row icon={<RssIcon />} label="RSS feed" hint={<code className="break-all font-mono">{rssUrl}</code>}>
                  <CopyButton text={rssUrl!} compact label="Copy RSS link" />
                </Row>
                <Row icon={<RssIcon />} label="Atom feed" hint={<code className="break-all font-mono">{atomUrl}</code>}>
                  <CopyButton text={atomUrl!} compact label="Copy Atom link" />
                </Row>
              </>
            ) : (
              <Row icon={<ReadLinkIcon />} label="Read link" hint="Appears after the first note." />
            )}
          </>
        }
        posting={
          <>
            <DisclosureRow icon={<ApiIcon />} label="REST API">
              <p className="mb-2 text-muted">
                Everything the web page does, under <code className="font-mono">/api/v1</code>. This server&apos;s own spec:
              </p>
              <pre className="overflow-x-auto rounded-xl bg-surface-2 p-3 font-mono text-[13px] text-ink">{`${base}/api/v1/openapi.json`}</pre>
              <DocsLink href={`${DOCS}/integrations/api/`}>REST API</DocsLink>
            </DisclosureRow>
            <DisclosureRow icon={<ScriptIcon />} label="Post from a script">
              <pre className="overflow-x-auto rounded-xl bg-surface-2 p-3 font-mono text-[13px] text-ink">{curlFor(base, feed, access === "unlocked")}</pre>
              <DocsLink href={`${DOCS}/using/posting/`}>Posting notes</DocsLink>
            </DisclosureRow>
            <DisclosureRow icon={<CodeIcon />} label="Post from code">
              <p className="mb-2 text-muted">The client libraries for Python and JavaScript take the server and the feed from the environment.</p>
              <pre className="overflow-x-auto rounded-xl bg-surface-2 p-3 font-mono text-[13px] text-ink">{`pip install notefeed\nnpm install notefeed`}</pre>
              <DocsLink href={`${DOCS}/integrations/clients/`}>Client libraries</DocsLink>
            </DisclosureRow>
            <DisclosureRow icon={<PhoneIcon />} label="Share from an iPhone">
              <p className="mb-2 text-muted">
                A ready-made Shortcut puts <strong className="text-ink">Send to notefeed</strong> in the iPhone&apos;s share sheet: pictures, text and links you
                share arrive as one note in this feed.
              </p>
              <ol className="mb-2 list-decimal space-y-2 pl-5 text-muted">
                <li>
                  On the iPhone, open this page in Safari and tap{" "}
                  <a href={SHORTCUT_PATH} download="Send to notefeed.shortcut" className="text-carbon underline">
                    Download the Shortcut
                  </a>
                  . Confirm with <strong className="text-ink">Download</strong>.
                </li>
                <li>
                  Open the download: tap the <strong className="text-ink">download arrow</strong> in Safari&apos;s address bar, then{" "}
                  <strong className="text-ink">Downloads</strong>, then <strong className="text-ink">Send to notefeed</strong>. (Or in the Files app:{" "}
                  <strong className="text-ink">Downloads</strong>, then the file.)
                </li>
                <li>
                  The Shortcuts app opens. Tap <strong className="text-ink">Set Up Shortcut</strong> and answer its four questions:
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    <li>
                      the address: <code className="break-all font-mono">{base}</code>
                    </li>
                    <li>
                      the feed name: <code className="break-all font-mono">{feed}</code>
                    </li>
                    <li>the feed&apos;s password (leave it empty for an open feed)</li>
                    <li>
                      the server password, which is optional:{" "}
                      {locked() ? "this server has one, the one you signed in with" : "leave it empty, this server has none"}
                    </li>
                  </ul>
                  Then tap <strong className="text-ink">Add Shortcut</strong>.
                </li>
                <li>
                  Share from any app (Photos, Notes, Safari …), scroll to the very bottom of the share sheet and tap{" "}
                  <strong className="text-ink">Send to notefeed</strong>. The first time, iOS asks whether it may send to your notefeed address: tap{" "}
                  <strong className="text-ink">Always Allow</strong>.
                </li>
                <li>
                  For several feeds, add it once per feed and rename each: in the Shortcuts app, touch and hold it, then{" "}
                  <strong className="text-ink">Rename</strong> (say, &ldquo;Send to {feed}&rdquo;).
                </li>
              </ol>
              <DocsLink href={`${DOCS}/using/sharing/#iphone`}>Sharing</DocsLink>
            </DisclosureRow>
            <DisclosureRow icon={<PhoneIcon />} label="Share from Android">
              <p className="mb-2 text-muted">
                Installed as an app, notefeed is in Android&apos;s share sheet: pictures, text and links go into this feed&apos;s compose box, ready to post.
              </p>
              <ol className="mb-2 list-decimal space-y-2 pl-5 text-muted">
                <li>
                  On the phone, open this feed in <strong className="text-ink">Chrome</strong>, open Chrome&apos;s menu (<strong className="text-ink">⋮</strong>
                  ) and tap <strong className="text-ink">Add to Home screen</strong> or <strong className="text-ink">Install app</strong>.
                </li>
                <li>Open notefeed once from the home screen, so the share sheet can hand pictures to it.</li>
                <li>
                  Share from any app (Photos, a browser …) and tap <strong className="text-ink">notefeed</strong>. Pick this feed,{" "}
                  <code className="break-all font-mono">{feed}</code>, check what is in the compose box, then <strong className="text-ink">Post</strong>.
                </li>
              </ol>
              <DocsLink href={`${DOCS}/using/sharing/#android`}>Sharing</DocsLink>
            </DisclosureRow>
            <DisclosureRow icon={<AgentIcon />} label="Post from an AI agent">
              <p className="mb-2 text-muted">Add notefeed to Claude Code as an MCP server; the agent then posts to this feed by its name.</p>
              <pre className="overflow-x-auto rounded-xl bg-surface-2 p-3 font-mono text-[13px] text-ink">{claudeMcpFor(base)}</pre>
              <DocsLink href={`${DOCS}/integrations/mcp/`}>MCP, and other clients</DocsLink>
            </DisclosureRow>
          </>
        }
      >
        {licensingOn() && <LicenseSection feed={feed} freeTier={await freeTier(feed)} licensePage={await licensePageOn()} />}
        {access === "unlocked" && (
          <FeedSettings
            feed={feed}
            error={passwordError ? feedErrorMessage(error, retry) : undefined}
            notice={passwordNotice(saved)}
            recover={licensingOn() ? { open: recoverForm, error: recoverForm ? recoverErrorMessage(error, retry) : undefined } : undefined}
          />
        )}
        {access === "open" && <ProtectFeed feed={feed} error={form === "protect" ? protectErrorMessage(error, retry) : undefined} />}
      </FeedDetails>
    </AppShell>
  );
}

const DOCS = "https://docs.notefeed.me";

function DocsLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="mt-2 inline-flex items-center gap-1 text-carbon underline">
      {children} in the docs
      <ExternalIcon aria-hidden className="h-3.5 w-3.5" />
    </a>
  );
}
