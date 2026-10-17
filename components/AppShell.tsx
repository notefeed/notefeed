import Link from "next/link";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { ArrowUpRight, ChevronDown, Info, LogOut, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { IDENTITY_COOKIE, SESSION_COOKIE, locked, sessionOk } from "@/backend";
import { Disclosure } from "@/components/Disclosure";
import { footerLinks, type FooterLink } from "@/components/LegalLinks";
import { RememberedFeedLinks } from "@/components/RememberedFeeds";
import { card, iconButton, sectionLabel } from "@/components/styles";

// The frame of a feed's pages (issue #185, .superdesign/design-system.md). On a phone: a top bar (logo, the feed
// switcher, the ⓘ menu), then the feed's details (`about`) and the page. From lg the feeds this browser remembers sit
// in a left column with the ⓘ menu at its foot; from xl `about` moves to a right column. The grid in globals.css (.shell) places
// one element per area, so nothing is rendered twice. Between lg and xl `about` sits on top of the page inside the same
// bordered middle column, so the two read as one.
// `feed`: the feed's name, on its writable pages only; the read-only pages must never show it, so they pass none and
// get no switcher.
// `docked`: `about` is fixed to the bottom of a phone's screen (the note's actions), so its area takes no room there.
export async function AppShell({ feed, about, docked = false, children }: { feed?: string; about?: ReactNode; docked?: boolean; children: ReactNode }) {
  await connection(); // the footer looks for the operator's files on every request
  const loggedIn = await hasSession();
  const links = await footerLinks();
  return (
    <div className="shell mx-auto min-h-dvh max-w-[80rem] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] lg:px-6">
      <TopBar feed={feed} links={links} loggedIn={loggedIn} />

      <aside aria-label="Feeds" className="sticky top-0 hidden h-dvh flex-col self-start py-6 [grid-area:nav] lg:flex">
        <Logo wordmark />
        {feed !== undefined && (
          <>
            <p className={`${sectionLabel} mt-8 px-2`}>Your feeds</p>
            <div className="mt-2 min-h-0 overflow-y-auto">
              <RememberedFeedLinks current={feed} />
            </div>
          </>
        )}
        <Link href="/" className="mt-3 flex items-center gap-3 rounded-xl px-2 py-2 text-[15px] font-bold text-carbon hover:bg-surface-2">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-carbon text-on-carbon">
            <Plus aria-hidden className="h-[18px] w-[18px]" />
          </span>
          Open or create a feed
        </Link>
        <div className="mt-auto flex items-center gap-1 border-t border-rule pt-3">
          <InfoMenu links={links} loggedIn={false} up />
          {loggedIn && <LogOutButton className="ml-auto inline-flex items-center gap-1.5 rounded-full px-2 py-1.5 text-[13px] text-muted hover:bg-surface-2 hover:text-ink" />}
        </div>
      </aside>

      {about && <div className={`${docked ? "" : "px-4 pt-4"} [grid-area:about] lg:border-x lg:border-rule/70 lg:px-6 lg:pt-6 xl:sticky xl:border-x-0 xl:px-0 xl:top-0 xl:max-h-dvh xl:self-start xl:overflow-y-auto xl:py-6`}>{about}</div>}

      <main className="min-w-0 px-4 pt-4 pb-28 [grid-area:main] lg:border-x lg:border-rule/70 lg:px-6 lg:pt-6 lg:pb-10 xl:row-span-1">{children}</main>
    </div>
  );
}

// Whether "Log out" is offered: readers of /r/** on a locked instance have no session, and an open instance has none at all.
export async function hasSession() {
  const jar = await cookies();
  return locked() && sessionOk(jar.get(SESSION_COOKIE)?.value, jar.get(IDENTITY_COOKIE)?.value);
}

function Logo({ wordmark = false }: { wordmark?: boolean }) {
  return (
    <Link href="/" className="inline-flex shrink-0 items-center gap-2.5 px-2" aria-label="notefeed home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon.svg" alt="" className="h-8 w-8" />
      {wordmark && <span className="text-xl font-bold tracking-tight">notefeed</span>}
    </Link>
  );
}

function LogOutButton({ className }: { className: string }) {
  return (
    <form method="post" action="/logout">
      <button type="submit" className={className}>
        <LogOut aria-hidden className="h-4 w-4" />
        Log out
      </button>
    </form>
  );
}

// The phone's top bar. A <div>, not a <header>: the page's header is the feed's details (`about`). No backdrop blur: it
// would make the bar the containing block of the sheets inside it, which are fixed to the screen. Above the docked
// composer bar (z-30), so the switcher's sheet covers it.
function TopBar({ feed, links, loggedIn }: { feed?: string; links: { product: FooterLink[]; legal: FooterLink[] }; loggedIn: boolean }) {
  return (
    <div className="sticky top-0 z-40 flex items-center gap-2 border-b border-rule/70 bg-paper/95 px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] [grid-area:top] lg:hidden">
      <Logo wordmark={feed === undefined} />
      <div className="flex min-w-0 flex-1 justify-center">{feed !== undefined && <FeedSwitcher feed={feed} />}</div>
      <InfoMenu links={links} loggedIn={loggedIn} />
    </div>
  );
}

// The feed switcher: the remembered feeds in a sheet, and a field to open another one (a plain GET form to the start page).
function FeedSwitcher({ feed }: { feed: string }) {
  return (
    <Disclosure
      sheet
      label="Switch feed"
      className="min-w-0"
      summaryClassName="flex min-w-0 items-center gap-1.5 rounded-full border border-rule bg-surface-2 py-1.5 pl-3 pr-2"
      summary={
        <>
          <span className="truncate text-[15px] font-bold tracking-tight text-carbon">{feed}</span>
          <ChevronDown aria-hidden className="h-[18px] w-[18px] shrink-0 text-muted" />
        </>
      }
    >
      <div className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-surface px-[max(0.75rem,env(safe-area-inset-left),env(safe-area-inset-right))] pb-[max(2rem,env(safe-area-inset-bottom))] pt-2 shadow-sheet">
        <div className="flex justify-center pb-2">
          <span className="h-1 w-10 rounded-full bg-rule" />
        </div>
        <p className="px-2 text-[17px] font-bold">Your feeds</p>
        <p className="mb-3 px-2 text-[13px] text-muted">Remembered on this device.</p>
        <RememberedFeedLinks current={feed} />
        <form method="get" action="/" className="mt-4 flex gap-2 px-2">
          <label htmlFor="switch-feed" className="sr-only">
            Open a feed by name
          </label>
          <input id="switch-feed" name="feed" required autoCapitalize="none" autoComplete="off" spellCheck={false} placeholder="Open a feed by name" className="min-w-0 flex-1 rounded-full border border-rule bg-surface-2 px-4 py-2 font-mono text-sm focus:border-carbon focus:outline-none" />
          <button type="submit" className="rounded-full bg-carbon px-4 py-2 font-bold text-on-carbon">
            Open
          </button>
        </form>
      </div>
    </Disclosure>
  );
}

// ⓘ: the product links and the operator's legal pages, and "Log out" on a locked instance. On the phone's top bar of a
// feed's pages, and on every plain page (app/(site)/layout.tsx). `up`: at the foot of the left column, labelled, opening upwards.
export function InfoMenu({ links, loggedIn, up = false }: { links: { product: FooterLink[]; legal: FooterLink[] }; loggedIn: boolean; up?: boolean }) {
  const row = "flex items-center gap-3 px-3 py-2.5 text-[15px] text-ink hover:bg-surface-2";
  const item = (l: FooterLink) =>
    l.external ? (
      <a key={l.href} href={l.href} className={row}>
        <span className="flex-1">{l.label}</span>
        <ArrowUpRight aria-hidden className="h-4 w-4 text-muted" />
      </a>
    ) : (
      <Link key={l.href} href={l.href} className={row}>
        {l.label}
      </Link>
    );
  return (
    <Disclosure
      label="About and legal"
      className="relative"
      summaryClassName={up ? "inline-flex items-center gap-2 rounded-full px-2 py-1.5 text-[13px] text-muted hover:bg-surface-2 hover:text-ink" : `${iconButton} text-muted`}
      summary={
        up ? (
          <>
            <Info aria-hidden className="h-5 w-5" />
            About &amp; legal
          </>
        ) : (
          <Info aria-hidden className="h-5 w-5" />
        )
      }
    >
      <div className={`${card} absolute z-40 w-56 py-1.5 shadow-sheet ${up ? "bottom-11 left-0" : "right-0 top-12"}`}>
        {links.product.map(item)}
        {links.legal.length > 0 && <div className="my-1.5 border-t border-rule" />}
        {links.legal.map(item)}
        {loggedIn && (
          <>
            <div className="my-1.5 border-t border-rule" />
            <LogOutButton className={`${row} w-full`} />
          </>
        )}
      </div>
    </Disclosure>
  );
}
