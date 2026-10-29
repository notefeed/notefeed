// GET /r/<readId>/<file> (next.config.ts rewrites a name with an extension here; note ids have none): a file of the feed, public like the read
// link (no password, even on a locked instance; proxy.ts skips /r/). Every file is served except dot files (the feed's own files and the
// notes' sidecars). The type comes from the extension and nothing else, whatever follows the header; what is not an image or text is a download.
// A note's own file name (`<id>.<ext>`) comes first; any other name is the newest note posted with that name (X-Note-Name, #250), so
// /r/<readId>/post-to-notefeed.md is always the current version of that file.
import { createHash } from "node:crypto";
import { feedForReadId, isRemovedReadId } from "../feeds";
import { measured } from "../metrics";
import { noteRoute } from "../requestscope";
import { fileVisible, isRemovedNote, namedFile, unreadableNote } from "../notes";
import { storage } from "../storage";
import { IMAGE_EXTS, contentTypeOf } from "../../shared/images";

const NAME_RE = /^[A-Za-z0-9_-]{1,128}\.([A-Za-z0-9]{1,16})$/;

// A file can be replaced under the same name (a note's `PUT`), so nothing is cached for good: the cache asks again with the ETag, a hash of the
// bytes, and gets a bodyless 304 while the file is unchanged. `private`: only the reader's own browser may keep a copy, so a file the
// operator removes (a takedown, issue #153) is gone from everywhere but that browser, which asks again at its next load and gets the 404.
// `ifNoneMatch` is the request's header, if any.
// A damaged note's file (issue #212): a picture says so where it is embedded, as a picture (a browser shows an image body whatever the
// status), and any other file in a line of text. Never cached.
const DAMAGED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="160" viewBox="0 0 480 160"><rect width="480" height="160" rx="16" fill="#e7e8e3"/><text x="240" y="86" text-anchor="middle" font-family="system-ui, sans-serif" font-size="18" fill="#55575c">This picture can't be shown</text></svg>`;
function damaged(ext: string): Response {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" };
  if ((IMAGE_EXTS as string[]).includes(ext)) return new Response(DAMAGED_SVG, { status: 500, headers: { ...headers, "Content-Type": "image/svg+xml" } });
  return new Response("This note can't be shown: its stored copy can't be decrypted.", { status: 500, headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" } });
}

export const fileRoute = (readId: string, file: string, ifNoneMatch?: string | null): Promise<Response> =>
  measured("feed_file", () => serveFile(readId, file, ifNoneMatch), (r) => r.status);

async function serveFile(readId: string, file: string, ifNoneMatch?: string | null): Promise<Response> {
  noteRoute("/r/[readId]/files/[file]"); // reached by a rewrite: the path has the shape of a note's page
  const feed = await feedForReadId(readId);
  const id = NAME_RE.exec(file) && file.slice(0, file.indexOf("."));
  if (feed && id && (await isRemovedNote(feed, id, new Date()))) return new Response("removed by the operator", { status: 410 }); // #159
  const now = new Date();
  let stored: string | null = null;
  let bytes: Buffer | null;
  try {
    // A note dated after now (scheduled) is a missing one to a reader, its file too; asked before any bytes are read.
    const own = feed && NAME_RE.test(file) && (await fileVisible(feed, file, now)) ? file : null;
    stored = own ?? (feed ? await namedFile(feed, file, now) : null);
    bytes = feed && stored ? await storage().readFile(feed, stored) : null;
  } catch (e) {
    const damagedFile = stored ?? file;
    unreadableNote(damagedFile.slice(0, damagedFile.indexOf(".")), e); // throws anything but a stored copy that does not decrypt
    return damaged(NAME_RE.exec(damagedFile)?.[1] ?? "");
  }
  const ext = stored ? NAME_RE.exec(stored)?.[1] : undefined;
  if (!feed && (await isRemovedReadId(readId))) return new Response("removed by the operator", { status: 410 });
  if (!bytes || !ext) return new Response("not found", { status: 404 });
  const image = (IMAGE_EXTS as string[]).includes(ext);
  const etag = `"${createHash("sha1").update(bytes).digest("base64url")}"`;
  const headers = {
    "Content-Type": contentTypeOf(ext),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-cache",
    ETag: etag,
    "Content-Security-Policy": "default-src 'none'; sandbox",
    ...(!image && ext !== "md" && { "Content-Disposition": "attachment" }),
  };
  if (ifNoneMatch?.split(",").some((t) => t.trim() === etag)) return new Response(null, { status: 304, headers });
  return new Response(bytes as BodyInit, { headers });
}
