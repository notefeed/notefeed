import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { AgentIcon, ApiIcon, BackIcon, CodeIcon, ExternalIcon, PhoneIcon, ReadLinkIcon, RssIcon, ScriptIcon } from "@/components/icons";
import { claudeMcpFor, curlFor } from "@/app/_lib/curl";
import { messagesFor } from "@/app/_lib/messages";
import { rich } from "@/components/rich";
import { copyFor, type Copy } from "@/shared/copy";
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

export const generateMetadata = async ({ params }: PageProps<"/[lang]/[feed]/settings">): Promise<Metadata> => ({
  title: copyFor((await params).lang).settings.title,
});

export default async function SettingsPage({ params, searchParams }: PageProps<"/[lang]/[feed]/settings">) {
  const { feed, lang } = await params;
  const all = copyFor(lang);
  const t = all.settings;
  const { feedDetailsErrorMessage, feedErrorMessage, passwordNotice, protectErrorMessage, recoverErrorMessage } = messagesFor(all);
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
        <Link href={feedPath(feed)} className={iconButton} aria-label={t.back} title={t.back}>
          <BackIcon aria-hidden className="h-5 w-5" />
        </Link>
        <h2 className="text-2xl font-bold tracking-tight">{t.heading}</h2>
      </div>
      {saved === "1" && (
        <p role="status" className="mb-4 text-sm text-carbon">
          {t.saved}
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
        renamable={!isReservedFeed(feed)}
        error={detailsError ? feedDetailsErrorMessage(error, retry) : undefined}
        sharing={
          <>
            {readUrl ? (
              <>
                <div>
                  <Row icon={<ReadLinkIcon />} label={t.readLink} hint={t.readLinkHint}>
                    <CopyButton text={readUrl} compact label={t.copyReadLink} />
                  </Row>
                  <code className="-mt-1 block break-all px-4 pb-3 pl-[3.75rem] font-mono text-[13px] text-carbon">{readUrl}</code>
                </div>
                <Row icon={<RssIcon />} label={t.rssFeed} hint={<code className="break-all font-mono">{rssUrl}</code>}>
                  <CopyButton text={rssUrl!} compact label={t.copyRss} />
                </Row>
                <Row icon={<RssIcon />} label={t.atomFeed} hint={<code className="break-all font-mono">{atomUrl}</code>}>
                  <CopyButton text={atomUrl!} compact label={t.copyAtom} />
                </Row>
              </>
            ) : (
              <Row icon={<ReadLinkIcon />} label={t.readLink} hint={t.afterFirstNote} />
            )}
          </>
        }
        posting={
          <>
            <DisclosureRow icon={<ApiIcon />} label={t.restApi}>
              <p className="mb-2 text-muted">{rich(t.restApiIntro, { code: "font-mono" })}</p>
              <pre className="overflow-x-auto rounded-xl bg-surface-2 p-3 font-mono text-[13px] text-ink">{`${base}/api/v1/openapi.json`}</pre>
              <DocsLink t={t} href={`${DOCS}/integrations/api/`}>
                {t.restApi}
              </DocsLink>
            </DisclosureRow>
            <DisclosureRow icon={<ScriptIcon />} label={t.script}>
              <pre className="overflow-x-auto rounded-xl bg-surface-2 p-3 font-mono text-[13px] text-ink">{curlFor(base, feed, access === "unlocked")}</pre>
              <DocsLink t={t} href={`${DOCS}/using/posting/`}>
                {t.postingNotes}
              </DocsLink>
            </DisclosureRow>
            <DisclosureRow icon={<CodeIcon />} label={t.code}>
              <p className="mb-2 text-muted">{t.codeIntro}</p>
              <pre className="overflow-x-auto rounded-xl bg-surface-2 p-3 font-mono text-[13px] text-ink">{`pip install notefeed\nnpm install notefeed`}</pre>
              <DocsLink t={t} href={`${DOCS}/integrations/clients/`}>
                {t.clientLibraries}
              </DocsLink>
            </DisclosureRow>
            <DisclosureRow icon={<PhoneIcon />} label={t.iphone}>
              <p className="mb-2 text-muted">{rich(t.iphoneIntro)}</p>
              <ol className="mb-2 list-decimal space-y-2 pl-5 text-muted">
                <li>
                  {t.iphoneOpen}{" "}
                  <a href={SHORTCUT_PATH} download="Send to notefeed.shortcut" className="text-carbon underline">
                    {t.iphoneDownload}
                  </a>
                  {rich(t.iphoneConfirm)}
                </li>
                <li>{rich(t.iphoneOpenDownload)}</li>
                <li>
                  {rich(t.iphoneSetUp)}
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    <li>{rich(t.iphoneAddress(base))}</li>
                    <li>{rich(t.iphoneFeed(feed))}</li>
                    <li>{t.iphoneFeedPassword}</li>
                    <li>
                      {t.iphoneServerPassword} {locked() ? t.iphoneLocked : t.iphoneOpen2}
                    </li>
                  </ul>
                  {rich(t.iphoneAdd)}
                </li>
                <li>{rich(t.iphoneShare)}</li>
                <li>{rich(t.iphoneSeveral(feed))}</li>
              </ol>
              <DocsLink t={t} href={`${DOCS}/using/sharing/#iphone`}>
                {t.sharing}
              </DocsLink>
            </DisclosureRow>
            <DisclosureRow icon={<PhoneIcon />} label={t.android}>
              <p className="mb-2 text-muted">{t.androidIntro}</p>
              <ol className="mb-2 list-decimal space-y-2 pl-5 text-muted">
                <li>{rich(t.androidInstall)}</li>
                <li>{t.androidOnce}</li>
                <li>{rich(t.androidShare(feed))}</li>
              </ol>
              <DocsLink t={t} href={`${DOCS}/using/sharing/#android`}>
                {t.sharing}
              </DocsLink>
            </DisclosureRow>
            <DisclosureRow icon={<AgentIcon />} label={t.agent}>
              <p className="mb-2 text-muted">{t.agentIntro}</p>
              <pre className="overflow-x-auto rounded-xl bg-surface-2 p-3 font-mono text-[13px] text-ink">{claudeMcpFor(base)}</pre>
              <DocsLink t={t} href={`${DOCS}/integrations/mcp/`}>
                {t.mcp}
              </DocsLink>
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

function DocsLink({ t, href, children }: { t: Copy["settings"]; href: string; children: string }) {
  return (
    <a href={href} className="mt-2 inline-flex items-center gap-1 text-carbon underline">
      {t.inTheDocs(children)}
      <ExternalIcon aria-hidden className="h-3.5 w-3.5" />
    </a>
  );
}
