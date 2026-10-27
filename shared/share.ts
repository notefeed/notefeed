// What another app shared to notefeed (the share target in app/manifest.ts), as it travels from the start page to the picked
// feed, through its password form and the sign-in: the title, text and link, and `shared` when pictures wait in the browser
// (public/sw.js). Only these are ever carried, so a carried query can't smuggle an `error` or anything else into a page.
export const SHARE_PARAMS = ["share_title", "share_text", "share_url", "shared"] as const;

// "" when nothing was shared, else "?..." with the non-empty ones (the first of a repeated one).
export function shareQuery(params: Record<string, unknown> | URLSearchParams): string {
  const get = (k: string): unknown => (params instanceof URLSearchParams ? params.get(k) : [params[k]].flat()[0]);
  const kept = SHARE_PARAMS.flatMap((k) => {
    const v = get(k);
    return typeof v === "string" && v !== "" ? [[k, v]] : [];
  });
  return kept.length ? `?${new URLSearchParams(kept)}` : "";
}
