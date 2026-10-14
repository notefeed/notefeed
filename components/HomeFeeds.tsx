"use client";

import { RememberedFeedLinks, useRememberedFeeds } from "@/components/RememberedFeeds";
import { card, sectionLabel } from "@/components/styles";

// The start page's "Your feeds": only when this browser remembers any (components/RememberedFeeds.tsx). `query`: what was
// shared to notefeed, carried to the feed that is picked.
export function HomeFeeds({ query = "", label = "Your feeds" }: { query?: string; label?: string }) {
  const feeds = useRememberedFeeds();
  if (!feeds.length) return null;
  return (
    <section aria-labelledby="your-feeds" className="mb-8">
      <h2 id="your-feeds" className={`${sectionLabel} mb-2 px-1`}>
        {label}
      </h2>
      <div className={`${card} p-2`}>
        <RememberedFeedLinks query={query} />
      </div>
    </section>
  );
}
