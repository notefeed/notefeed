# Layouts

There is no sidebar or bottom nav. Every page is a single centered column (max-w-[68ch]) from the root layout, with the Header at the top of each page (rendered by the page itself) and a text-link footer from the root layout.

## `app/layout.tsx`

Root layout: Atkinson Hyperlegible Next/Mono fonts, centered 68ch column, footer with Docs/GitHub/Imprint/Data privacy/Terms/License text links.

```tsx
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import Link from "next/link";
import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next } from "next/font/google";
import { hasLegalPage, licensingOn, publicUrl } from "@/backend";
import "./globals.css";

const sans = Atkinson_Hyperlegible_Next({ variable: "--font-atkinson", subsets: ["latin"] });
const mono = Atkinson_Hyperlegible_Mono({ variable: "--font-atkinson-mono", subsets: ["latin"] });

const description = "Markdown notes and RSS. Post from where you need it, follow where you want.";

// metadataBase makes the share image's URL absolute, on whatever host this instance is reached.
export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: new URL(publicUrl(await headers())),
    title: { default: "notefeed", template: "%s · notefeed" },
    description,
  };
}

export const viewport: Viewport = { themeColor: [{ color: "#f2f3f0", media: "(prefers-color-scheme: light)" }, { color: "#15161b", media: "(prefers-color-scheme: dark)" }] };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The imprint and the privacy page are the operator's own files (backend/legal.ts), looked for on every request:
  // a link only where there is a page.
  await connection();
  const [imprint, privacy, terms] = await Promise.all([hasLegalPage("imprint"), hasLegalPage("privacy"), hasLegalPage("terms")]);
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} antialiased`}>
      <body className="font-sans text-base leading-relaxed">
        <div className="mx-auto max-w-[68ch] px-4 py-8 sm:py-12">{children}
          <footer className="mt-12 flex gap-5 border-t border-rule pt-4 text-sm text-muted">
            <a href="https://docs.notefeed.me/" className="hover:text-ink hover:underline">
              Docs
            </a>
            <a href="https://github.com/notefeed/notefeed" className="hover:text-ink hover:underline">
              GitHub
            </a>
            {imprint && (
              <Link href="/imprint" className="hover:text-ink hover:underline">
                Imprint
              </Link>
            )}
            {privacy && (
              <Link href="/privacy" className="hover:text-ink hover:underline">
                Data privacy
              </Link>
            )}
            {terms && (
              <Link href="/terms" className="hover:text-ink hover:underline">
                Terms
              </Link>
            )}
            {licensingOn() && (
              <Link href="/license" className="hover:text-ink hover:underline">
                License
              </Link>
            )}
          </footer>
        </div>
      </body>
    </html>
  );
}
```

## `components/Header.tsx`

Page header: optional feed title image, breadcrumb (logo /icon.svg + 'notefeed' › feed name in carbon), right-side icon actions (Read-only, RSS, Settings, Log out) whose labels show from sm: up.

```tsx
import Link from "next/link";
import { cookies } from "next/headers";
import { ChevronRight, Eye, LogOut, Rss, Settings } from "lucide-react";
import { IDENTITY_COOKIE, SESSION_COOKIE, feedPath, locked, sessionOk } from "@/backend";

const action = "inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-muted hover:bg-rule/50 hover:text-ink";
const icon = "h-4 w-4 shrink-0";
// The words go on wide screens; the icon alone is enough on a phone, and the link keeps its name for screen readers.
const label = "hidden sm:inline";

// `feed` only on the writable pages; the read-only pages must never show it. `view` and `settingsHref` are the
// writable feed page's links to its read-only view and its settings page (none on the settings page itself).
export async function Header({ feed, rss, image, view, settingsHref }: { feed?: string; rss?: string; image?: string | null; view?: string; settingsHref?: string }) {
  // Readers of /r/** on a locked instance have no session: no "Log out" for them.
  const jar = await cookies();
  const loggedIn = locked() && sessionOk(jar.get(SESSION_COOKIE)?.value, jar.get(IDENTITY_COOKIE)?.value);
  return (
    <header className="mb-8 flex items-center justify-between gap-3">
      {image && (
        // The feed's title image: decorative (the name is next to it), served by our own route.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="h-10 w-auto max-w-24 shrink-0 self-center rounded-sm object-contain" />
      )}
      <nav aria-label="Breadcrumb" className="mr-auto flex min-w-0 items-center gap-1.5 text-xl font-bold tracking-tight">
        <Link href="/" className="inline-flex shrink-0 items-center gap-2" aria-label="notefeed home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" className="h-7 w-7" />
          <span className={feed ? "sr-only sm:not-sr-only" : undefined}>notefeed</span>
        </Link>
        {feed && (
          <>
            <ChevronRight aria-hidden className="h-5 w-5 shrink-0 text-muted" />
            <Link href={feedPath(feed)} className="min-w-0 truncate text-carbon">
              {feed}
            </Link>
          </>
        )}
      </nav>
      <div className="flex shrink-0 items-center gap-1 text-sm">
        {view && (
          <Link href={view} className={action} aria-label="Open read-only view" title="Open read-only view">
            <Eye aria-hidden className={icon} />
            <span className={label}>Read-only</span>
          </Link>
        )}
        {rss && (
          <a href={rss} className={action} aria-label="RSS" title="RSS feed">
            <Rss aria-hidden className={icon} />
            <span className={label}>RSS</span>
          </a>
        )}
        {settingsHref && (
          <Link href={settingsHref} className={action} aria-label="Settings" title="Feed settings">
            <Settings aria-hidden className={icon} />
            <span className={label}>Settings</span>
          </Link>
        )}
        {loggedIn && (
          <form method="post" action="/logout">
            <button type="submit" className={action} aria-label="Log out" title="Log out">
              <LogOut aria-hidden className={icon} />
              <span className={label}>Log out</span>
            </button>
          </form>
        )}
      </div>
    </header>
  );
}
```

## `components/LegalPage.tsx`

Header + operator markdown, used by /imprint, /privacy, /terms.

```tsx
import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { NoteView } from "@/components/NoteView";
import { readLegalPage, type LegalPage as Which } from "@/backend";

// The operator's own imprint or privacy page: their Markdown file, shown like a note (raw HTML stays text). notefeed
// ships no such text, so without a file there is no page.
export async function LegalPage({ which }: { which: Which }) {
  const markdown = await readLegalPage(which);
  if (markdown === null) notFound();
  return (
    <>
      <Header />
      <main>
        <NoteView markdown={markdown} />
      </main>
    </>
  );
}
```

