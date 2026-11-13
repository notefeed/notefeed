import Link from "next/link";
import { ReadOnlyIcon, RssIcon, SettingsIcon, TagIcon } from "@/components/icons";
import type { ReactNode } from "react";
import { CopyButton } from "@/components/CopyButton";
import { ShareButton } from "@/components/ShareButton";
import { card, sectionLabel } from "@/components/styles";
import { serverCopy } from "@/app/_lib/copy";

// A feed's details (issue #185): its image, title and description, the ways to share it and its tags as the
// filter. The page's <header>: at the top of the page on a phone, the right column from xl (components/AppShell.tsx).
// `name` only on the writable pages; the read-only pages never show it. `readUrl` and `rssUrl` exist once the feed has a
// note. `tags` are the tags of the notes the page shows (the newest ones), `tag` the one the list is filtered by. `children`:
// what goes right under the card (a new feed's protection, components/ProtectFeed.tsx).
export async function FeedAbout({
  name,
  title,
  description,
  imageUrl,
  readUrl,
  rssUrl,
  viewHref,
  settingsHref,
  tags = [],
  tag,
  base,
  children,
}: {
  name?: string;
  title: string;
  description: string;
  imageUrl: string | null;
  readUrl?: string;
  rssUrl?: string;
  viewHref?: string;
  settingsHref?: string;
  tags?: string[];
  tag?: string;
  base: string;
  children?: ReactNode;
}) {
  const t = (await serverCopy()).feedAbout;
  const round = "inline-flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-ink hover:bg-rule/60";
  return (
    <div className="space-y-4">
      <header className={`${card} p-4 xl:p-5`}>
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl ?? "/icon.svg"}
            alt=""
            className={`h-14 w-14 shrink-0 rounded-full border border-rule bg-surface xl:h-16 xl:w-16 ${imageUrl ? "object-cover" : "p-2"}`}
          />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold leading-tight tracking-tight">{title || name || "notefeed"}</h1>
            {name && title && <p className="mt-0.5 truncate font-mono text-[13px] text-carbon">{name}</p>}
          </div>
        </div>
        {description && <p className="mt-3 text-[15px] text-muted">{description}</p>}
        {(readUrl || settingsHref || viewHref || rssUrl) && (
          <div className="mt-4 flex items-center gap-2">
            {readUrl && <ShareButton url={readUrl} title={title} />}
            {rssUrl && !name && (
              // The read-only view: following the feed is the one thing to do here.
              <a
                href={rssUrl}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-carbon px-4 py-2 text-[14px] font-bold text-on-carbon"
              >
                <RssIcon aria-hidden className="h-4 w-4" />
                {t.subscribe}
                <span className="sr-only">{t.viaRss}</span>
              </a>
            )}
            {rssUrl && name && (
              <a href={rssUrl} className={round} aria-label={t.rss} title={t.rssFeed}>
                <RssIcon aria-hidden className="h-[18px] w-[18px]" />
              </a>
            )}
            {viewHref && (
              <Link href={viewHref} className={round} aria-label={t.openReadOnly} title={t.readOnly}>
                <ReadOnlyIcon aria-hidden className="h-[18px] w-[18px]" />
              </Link>
            )}
            {settingsHref && (
              <Link href={settingsHref} className={round} aria-label={t.settings} title={t.feedSettings}>
                <SettingsIcon aria-hidden className="h-[18px] w-[18px]" />
              </Link>
            )}
          </div>
        )}
      </header>

      {children}

      {name && readUrl && (
        <section aria-labelledby="about-read-link" className={`${card} hidden p-5 xl:block`}>
          <h2 id="about-read-link" className={sectionLabel}>
            {t.readLink}
          </h2>
          <p className="mt-1 text-[13px] text-muted">{t.readLinkHint}</p>
          <div className="mt-2 flex items-center gap-2 rounded-xl bg-surface-2 py-1.5 pl-3 pr-1.5">
            <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-carbon">{readUrl.replace(/^https?:\/\//, "")}</code>
            <CopyButton text={readUrl} compact label={t.copyReadLink} />
          </div>
        </section>
      )}

      {tags.length > 0 && (
        <nav aria-label={t.tags} className={`${card} p-3 xl:p-5`}>
          <h2 className={`${sectionLabel} hidden xl:block`}>{t.tags}</h2>
          <div className="flex gap-2 overflow-x-auto xl:mt-2 xl:block xl:space-y-0.5 xl:overflow-visible">
            <TagLink href={base} active={!tag} label={t.allNotes} filterBy={t.filterBy} />
            {tags.map((name) => (
              <TagLink key={name} href={`${base}?tag=${encodeURIComponent(name)}`} active={name === tag} label={name} filterBy={t.filterBy} hash />
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}

function TagLink({ href, active, label, filterBy, hash = false }: { href: string; active: boolean; label: string; filterBy: string; hash?: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-[14px] xl:rounded-lg xl:px-2.5 ${active ? "bg-carbon-soft font-bold text-carbon" : "bg-surface-2 hover:bg-rule/60 xl:bg-transparent xl:hover:bg-surface-2"}`}
    >
      {hash && <TagIcon aria-hidden className="h-3.5 w-3.5 text-muted" />}
      {hash && <span className="sr-only">{filterBy}</span>}
      {label}
    </Link>
  );
}
