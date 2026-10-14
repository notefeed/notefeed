"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

// The feeds this browser has opened (issue #185): notefeed has no accounts, so "your feeds" is a list in localStorage,
// newest first. It never leaves the browser. Storage can be unavailable (a private window, blocked site data): then the
// list is empty and nothing else changes.
export type RememberedFeed = { name: string; title: string; image: string | null };

const KEY = "notefeed:feeds";
const MAX = 50;
const EVENT = "notefeed:feeds"; // same-tab updates; other tabs get the storage event

let cache: { raw: string | null; list: RememberedFeed[] } = { raw: null, list: [] };

function read(): RememberedFeed[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return cache.list;
  }
  if (raw === cache.raw) return cache.list; // the same array while nothing changed, as useSyncExternalStore needs
  let list: RememberedFeed[] = [];
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    if (Array.isArray(parsed)) list = parsed.filter((f): f is RememberedFeed => typeof f?.name === "string").map((f) => ({ name: f.name, title: typeof f.title === "string" ? f.title : "", image: typeof f.image === "string" ? f.image : null }));
  } catch {}
  cache = { raw, list };
  return list;
}

function write(list: RememberedFeed[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

const EMPTY: RememberedFeed[] = [];
export function useRememberedFeeds(): RememberedFeed[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY); // empty on the server: the list is the browser's
}

export function forgetFeed(name: string) {
  write(read().filter((f) => f.name !== name));
}

// Rendered on a feed's writable pages: puts the feed first in the list, with its title and image as they are now.
export function RememberFeed({ feed }: { feed: RememberedFeed }) {
  const { name, title, image } = feed;
  useEffect(() => {
    write([{ name, title, image }, ...read().filter((f) => f.name !== name)]);
  }, [name, title, image]);
  return null;
}

// A remembered feed's avatar: its title image, else (also when the image is gone since) the initial of its title or name.
export function FeedAvatar({ feed, size = "h-9 w-9" }: { feed: RememberedFeed; size?: string }) {
  const [broken, setBroken] = useState(false);
  return feed.image && !broken ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={feed.image} alt="" onError={() => setBroken(true)} className={`${size} shrink-0 rounded-full border border-rule bg-surface object-cover`} />
  ) : (
    <span aria-hidden className={`${size} inline-flex shrink-0 items-center justify-center rounded-full bg-carbon-soft text-[13px] font-bold uppercase text-carbon`}>
      {(feed.title || feed.name)[0]}
    </span>
  );
}

// The list itself, for the left column and the switcher sheet. Links, not list items: the feed's notes are the page's list.
// `query`: appended to each link (what was shared to notefeed, app/(site)/page.tsx).
export function RememberedFeedLinks({ current, onNavigate, query = "" }: { current?: string; onNavigate?: () => void; query?: string }) {
  const feeds = useRememberedFeeds();
  if (!feeds.length) return <p className="px-2 text-[13px] text-muted">Feeds you open are remembered here, on this device.</p>;
  return (
    <div className="space-y-0.5">
      {feeds.map((f) => (
        <div key={f.name} className={`group flex items-center rounded-xl ${f.name === current ? "bg-carbon-soft" : "hover:bg-surface-2"}`}>
          <Link href={`/${f.name}${query}`} onClick={onNavigate} aria-current={f.name === current ? "page" : undefined} className="flex min-w-0 flex-1 items-center gap-3 px-2 py-2">
            <FeedAvatar feed={f} />
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-[15px] font-bold leading-tight ${f.name === current ? "text-carbon" : ""}`}>{f.title || f.name}</span>
              {f.title && <span className="block truncate font-mono text-[12px] leading-tight text-muted">{f.name}</span>}
            </span>
          </Link>
          {f.name !== current && (
            <button type="button" onClick={() => forgetFeed(f.name)} title="Forget on this device" aria-label={`Forget ${f.title || f.name} on this device`} className="mr-1 hidden h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-ink group-hover:inline-flex focus:inline-flex">
              <X aria-hidden className="h-4 w-4" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
