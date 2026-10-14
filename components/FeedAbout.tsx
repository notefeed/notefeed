import Link from "next/link";
import { Eye, Hash, Rss, Settings } from "lucide-react";
import { CopyButton } from "@/components/CopyButton";
import { ShareButton } from "@/components/ShareButton";
import { card, sectionLabel } from "@/components/styles";

// A feed's details (issue #185): its image, title and description, the ways to share it and its tags as the
// filter. The page's <header>: at the top of the page on a phone, the right column from xl (components/AppShell.tsx).
// `name` only on the writable pages; the read-only pages never show it. `readUrl` and `rssUrl` exist once the feed has a
// note. `tags` are the tags of the notes the page shows (the newest ones), `tag` the one the list is filtered by.
export function FeedAbout({ name, title, description, imageUrl, readUrl, rssUrl, viewHref, settingsHref, tags = [], tag, base }: {
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
}) {
  const round = "inline-flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-ink hover:bg-rule/60";
  return (
    <div className="space-y-4">
      <header className={`${card} p-4 xl:p-5`}>
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl ?? "/icon.svg"} alt="" className={`h-14 w-14 shrink-0 rounded-full border border-rule bg-surface xl:h-16 xl:w-16 ${imageUrl ? "object-cover" : "p-2"}`} />
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
              <a href={rssUrl} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-carbon px-4 py-2 text-[14px] font-bold text-on-carbon">
                <Rss aria-hidden className="h-4 w-4" />
                Subscribe<span className="sr-only"> via RSS</span>
              </a>
            )}
            {rssUrl && name && (
              <a href={rssUrl} className={round} aria-label="RSS" title="RSS feed">
                <Rss aria-hidden className="h-[18px] w-[18px]" />
              </a>
            )}
            {viewHref && (
              <Link href={viewHref} className={round} aria-label="Open read-only view" title="Read-only view">
                <Eye aria-hidden className="h-[18px] w-[18px]" />
              </Link>
            )}
            {settingsHref && (
              <Link href={settingsHref} className={round} aria-label="Settings" title="Feed settings">
                <Settings aria-hidden className="h-[18px] w-[18px]" />
              </Link>
            )}
          </div>
        )}
      </header>

      {name && readUrl && (
        <section aria-labelledby="about-read-link" className={`${card} hidden p-5 xl:block`}>
          <h2 id="about-read-link" className={sectionLabel}>
            Read link
          </h2>
          <p className="mt-1 text-[13px] text-muted">Shows the notes, not the name. Can&apos;t post.</p>
          <div className="mt-2 flex items-center gap-2 rounded-xl bg-surface-2 py-1.5 pl-3 pr-1.5">
            <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-carbon">{readUrl.replace(/^https?:\/\//, "")}</code>
            <CopyButton text={readUrl} compact label="Copy read link" />
          </div>
        </section>
      )}

      {tags.length > 0 && (
        <nav aria-label="Tags" className={`${card} p-3 xl:p-5`}>
          <h2 className={`${sectionLabel} hidden xl:block`}>Tags</h2>
          <div className="flex gap-2 overflow-x-auto xl:mt-2 xl:block xl:space-y-0.5 xl:overflow-visible">
            <TagLink href={base} active={!tag} label="All notes" />
            {tags.map((t) => (
              <TagLink key={t} href={`${base}?tag=${encodeURIComponent(t)}`} active={t === tag} label={t} hash />
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}

function TagLink({ href, active, label, hash = false }: { href: string; active: boolean; label: string; hash?: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-[14px] xl:rounded-lg xl:px-2.5 ${active ? "bg-carbon-soft font-bold text-carbon" : "bg-surface-2 hover:bg-rule/60 xl:bg-transparent xl:hover:bg-surface-2"}`}
    >
      {hash && <Hash aria-hidden className="h-3.5 w-3.5 text-muted" />}
      {hash && <span className="sr-only">Filter by </span>}
      {label}
    </Link>
  );
}
