// The operator's takedown (issue #155): a feed named by a read link, a read id or an image URL stops being served at once, its notes
// and image bytes go, a tombstone keeps its name and read id from ever being used again, and the hashes of its images go on the
// instance's blocklist, so the same bytes are refused in any feed (posting.ts checks). Nothing about anyone is written; the log
// line says what went, never the feed (ADR 0015).
import { releaseLicense } from "./licensing";
import { createHash } from "node:crypto";
import { InvalidRequestError, NotFoundError } from "./errors";
import { feedForReadId, isRemovedReadId, isReadId } from "./feeds";
import { logger } from "./log";
import { feedRemoved, noteDeleted } from "./metrics";
import { attachmentsOf, countNotes, isRemovedNote, isValidId, listNotes, namedFile, unreadableNote } from "./notes";
import { typeForExt } from "./note/types";
import { storage } from "./storage";
import { FeedGoneError, type NoteRef } from "./storage/types";

const log = logger("takedown");

export const imageHash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** The read id in a read link (`/r/<id>`, `/r/<id>/feed.xml`), an image URL (`/r/<id>/<file>`) or a note's read URL; a bare read id as it is. */
export function readIdOfTarget(target: string): string | null {
  const t = target.trim();
  if (isReadId(t)) return t;
  let path = t;
  if (/^https?:\/\//i.test(t)) {
    if (!URL.canParse(t)) return null;
    path = new URL(t).pathname;
  }
  const m = /^\/r\/([^/]+)(?:\/|$)/.exec(path);
  const id = m && decodeURIComponent(m[1]);
  return id && isReadId(id) ? id : null;
}

export type Takedown = { removed: boolean; already_removed: boolean; notes: number; images: number; blocked: number; image_keys: string[] };

export async function takedown(target: string): Promise<Takedown> {
  const readId = readIdOfTarget(target);
  if (!readId) throw new InvalidRequestError("give a read link, a read id or an image URL");
  const feed = await feedForReadId(readId);
  if (!feed) {
    if (await isRemovedReadId(readId)) return { removed: false, already_removed: true, notes: 0, images: 0, blocked: 0, image_keys: [] };
    throw new NotFoundError("no feed has this read id");
  }
  // The hashes before the bytes go. A feed is at most NOTEFEED_MAX_NOTES_PER_FEED; here there is no cap, and the images are read one at a time.
  const hashes = new Set<string>();
  for (const note of await listNotes(feed, Number.MAX_SAFE_INTEGER, undefined, undefined, "image")) {
    const bytes = await storage().readFile(feed, note.file);
    if (bytes) hashes.add(imageHash(bytes));
  }
  const notes = await countNotes(feed);
  const images = await countNotes(feed, "image");
  const { removed, keys } = await storage().takedownFeed(feed, readId);
  await storage().blockImages([...hashes]);
  await releaseLicense(feed);
  if (removed) feedRemoved("takedown");
  log.info({ notes, images, blocked: hashes.size, keys: keys.length }, "feed removed by the operator");
  return { removed, already_removed: false, notes, images, blocked: hashes.size, image_keys: keys };
}

/** The note a target names, for the takedown of one post (#159): a note's read URL (`/r/<read id>/<note id>`), an image URL
 *  (`/r/<read id>/<file>`, by id or by the name it was posted with), as a URL or a path, or `<read id>/<note>`, a slash at the end or
 *  not. A feed's read link, its RSS feed or a bare read id names no note: null. */
export function noteOfTarget(target: string): { readId: string; note: string } | null {
  let path = target.trim();
  if (/^https?:\/\//i.test(path)) {
    if (!URL.canParse(path)) return null;
    path = new URL(path).pathname;
  }
  const m = (path.startsWith("/") ? /^\/r\/([^/]+)\/([^/]+)\/?$/ : /^([^/]+)\/([^/]+)\/?$/).exec(path);
  if (!m) return null;
  let readId: string, note: string;
  try {
    [readId, note] = [decodeURIComponent(m[1]), decodeURIComponent(m[2])];
  } catch {
    return null;
  }
  return isReadId(readId) && note !== "feed.xml" ? { readId, note } : null;
}

export type NoteTakedown = { removed: boolean; already_removed: boolean; notes: string[]; blocked: number; image_keys: string[] };

const ALREADY: NoteTakedown = { removed: false, already_removed: true, notes: [], blocked: 0, image_keys: [] };

// The note a segment names: a file `<id>.<ext>` of a note, else the newest note posted under that name (drafts too), else a note id.
async function noteIdIn(feed: string, segment: string): Promise<string> {
  const file = /^([A-Za-z0-9_-]{1,128})\.[A-Za-z0-9]{1,16}$/.exec(segment);
  if (file && (await isRemovedNote(feed, file[1]))) return file[1]; // its file is gone, or is the mark's now
  if (file && (await storedRef(feed, file[1]))?.ext === segment.slice(file[1].length + 1)) return file[1];
  const named = await namedFile(feed, segment);
  return named ? named.split(".")[0] : segment;
}

// A note as the takedown needs it, from the listing alone: a damaged note (one whose stored copy does not decrypt) is found too.
async function storedRef(feed: string, id: string): Promise<NoteRef | undefined> {
  // `removed`: a note a takedown cut short left stored is found, to finish it; of a note and a mark with the same id, the note.
  if (!isValidId(id)) return undefined;
  const refs = (await storage().listNoteRefs(feed, { drafts: true, removed: true })).filter((r) => r.id === id && typeForExt(r.ext));
  return refs.find((r) => r.ext !== "removed") ?? refs[0];
}

// The text an attachment was posted with, from its metadata; none for a damaged one, whose metadata can't be read.
async function postedWith(feed: string, ref: NoteRef): Promise<string | undefined> {
  return (await storage().readMeta(feed, ref).catch((e) => (unreadableNote(ref.id, e), null)))?.of;
}

/** The takedown of one post (#159): the note a target names, the text note it was posted with, and every attachment of that text.
 *  Their images' hashes go on the blocklist first; then the storage records the tombstones, removes the notes and writes the mark
 *  (backend/note/removed.ts) in the text's place. A takedown cut short is finished by the next one: whatever of the post is still
 *  stored goes then. A damaged note goes too, by its id; its bytes can't be read, so it adds nothing to the blocklist. The answer
 *  never names the feed. */
export async function takedownNote(target: string): Promise<NoteTakedown> {
  const named = noteOfTarget(target);
  if (!named) throw new InvalidRequestError("give a note's read URL, an image URL or <read id>/<note id>");
  const feed = await feedForReadId(named.readId);
  if (!feed) {
    if (await isRemovedReadId(named.readId)) return ALREADY;
    throw new NotFoundError("no feed has this read id");
  }
  const id = await noteIdIn(feed, named.note);
  const found = await storedRef(feed, id);
  if (!found) {
    if (await isRemovedNote(feed, id)) return ALREADY;
    throw new NotFoundError("no such note");
  }
  const of = found.ext === "removed" ? undefined : await postedWith(feed, found);
  const text = (of && (await storedRef(feed, of))) || found;
  const post = [text, ...(await attachmentsOf(feed, text.id, true))].filter((r) => r.ext !== "removed"); // a cut-short takedown's mark stays
  if (post.length === 0) return ALREADY;
  // The mark goes where the text was: not again when it is there, and at the text's id when a cut-short takedown already took the text.
  const textGone = text === found && !!of && (await isRemovedNote(feed, of));
  const markId = text.ext === "removed" ? null : textGone ? of! : text.id;
  const hashes = new Set<string>();
  for (const ref of post) {
    if (typeForExt(ref.ext)?.name !== "image") continue; // a text has no bytes to block
    const bytes = await storage().readFile(feed, `${ref.id}.${ref.ext}`).catch((e) => (unreadableNote(ref.id, e), null));
    if (bytes) hashes.add(imageHash(bytes));
  }
  await storage().blockImages([...hashes]); // before the bytes go: a takedown cut short never leaves them unblocked
  let keys: string[];
  try {
    ({ keys } = await storage().takedownNotes(feed, post.map((r) => ({ id: r.id, ext: r.ext })), { date: text.date, draft: text.draft }, markId));
  } catch (e) {
    if (e instanceof FeedGoneError) throw new NotFoundError("no feed has this read id"); // deleted meanwhile, by its owner
    throw e;
  }
  for (const r of post) noteDeleted(typeForExt(r.ext)?.name ?? "unknown", "takedown");
  const notes = post.map((r) => r.id);
  log.info({ notes: notes.length, blocked: hashes.size, keys: keys.length }, "post removed by the operator");
  return { removed: true, already_removed: false, notes, blocked: hashes.size, image_keys: keys };
}

/** Whether these image bytes are on the blocklist. */
export async function isBlockedImage(bytes: Uint8Array): Promise<boolean> {
  return storage().isBlockedImage(imageHash(bytes));
}
