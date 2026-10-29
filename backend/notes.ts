// Notes: validation, ids and reading them back. Where they are kept is the storage backend's business (backend/storage).
import { randomBytes } from "node:crypto";
import { InvalidBodyError, RemovedNoteError, UnreadableNoteError, UnsupportedTypeError } from "./errors";
import { assertFeed, checkFeed, ensureFeed, forgetFeed } from "./feeds";
import { logger } from "./log";
import { noteDeleted, noteEdited, notePosted, noteUnreadable } from "./metrics";
import { storage } from "./storage";
import { CipherError } from "./storage/cipher";
import { FeedGoneError, type Meta, type NoteRef } from "./storage/types";
import { sniffImage } from "../shared/images";
import { cleanName, FORBIDDEN_IN_TEXT, MAX_ALT } from "../shared/links";
import { ImageNote } from "./note/image";
import { MarkdownNote } from "./note/markdown";
import { Note } from "./note/note";
import { UnreadableNote } from "./note/unreadable";
import { NOTE_TYPES, parseMediaType, typeForExt, type NoteType } from "./note/types";
import { checkTags } from "./tags";

export { checkMarkdown, MAX_BYTES } from "./note/markdown";
export { ImageNote, MarkdownNote, Note };
export { cleanName }; // defined in shared/links.ts, with the characters a name may not hold

export const MAX_NOTE_TITLE = 100;
export { MAX_ALT }; // defined in shared/links.ts: the web box holds to it too

// A note's title or alt text: trimmed, one line of at most `max` characters (an emoji is one). "" means none.
export function checkLine(name: string, value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  const v = value.trim();
  if (FORBIDDEN_IN_TEXT.test(v)) throw new InvalidBodyError(`${name} must be one line, without control or text-direction override characters`);
  if ([...v].length > max) throw new InvalidBodyError(`${name} must be at most ${max} characters`);
  return v;
}

/** A new note's id: 16 random bytes as 22 characters of base64url (like read ids). It carries nothing, the time included. */
export const newNoteId = (): string => randomBytes(16).toString("base64url");

// Ids are not enforced: any name without a dot is one, so a file placed by hand is a note.
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
// The extensions that are notes, in the order a lookup tries them.
const NOTE_EXTS = NOTE_TYPES.flatMap((t) => t.exts);
const withContent = (ext: string) => typeForExt(ext)?.needsContent ?? false;
// Sidecars read at once when a whole feed's metadata is looked through: more under one Promise.all can run out of file descriptors.
const READS_AT_ONCE = 64;

export function isValidId(id: string): boolean {
  return ID_RE.test(id);
}

// What a new note is made of; the feed is created if it doesn't exist (`wantedReadId` is used only then, see feeds.ts).
type NewNote = { ext: string; content: string | Uint8Array; meta: Meta };

// `readId`: the read id of the feed the note went into (null: that feed has no read link).
async function store(feed: string, base: string, { ext, content, meta }: NewNote, date: Date, wantedReadId?: string, draft = false): Promise<{ id: string; readId: string | null }> {
  // ponytail: checked, not locked. A post that is past ensureFeed when its feed is deleted and the name
  // re-created lands in the new feed (as do settings written after hasFeed); a per-feed lock would close it.
  for (let retried = false; ; retried = true) {
    const readId = await ensureFeed(feed, wantedReadId);
    try {
      return { id: await storage().writeNote(feed, base, ext, content, meta, date.getTime(), draft), readId };
    } catch (e) {
      // The listed feed is gone (deleted since ensureFeed, or its directory removed by hand): this is a new
      // feed. Once only: gone again means another delete, and that is an error.
      if (retried || !(e instanceof FeedGoneError)) throw e;
      await forgetFeed(feed, readId);
    }
  }
}

/** `id`: the id to store it under (a post that must know its text's id first), else a new one. `of`: on an attachment, its text note's id.
 *  `draft`: stored as a draft, which readers do not see (#265). */
export type NewNoteOptions = { sender?: string; tags?: string[]; title?: string; alt?: string; name?: string; wantedReadId?: string; id?: string; of?: string; draft?: boolean };

/**
 * A new note of any type: `body` is its file, `ext` the extension its type stores it under. The type's own rules (`checkBody`) apply; a
 * title or alt text must be one short line. The feed is created if it does not exist. Whether the body is what the poster declared is
 * posting.ts's business (`verify`). `date` places it in the feed; a time to come makes it scheduled.
 */
export async function createNoteOf(feed: string, type: NoteType, ext: string, body: Uint8Array, opts: NewNoteOptions = {}, date = new Date()): Promise<{ note: Note; readId: string | null }> {
  assertFeed(feed);
  type.checkBody(body);
  const title = checkLine("title", opts.title, MAX_NOTE_TITLE);
  const alt = checkLine("alt", opts.alt, MAX_ALT);
  if (alt && !type.hasAlt) throw new InvalidBodyError("alt is for image notes");
  const { sender, tags = [], of } = opts;
  const name = cleanName(opts.name);
  const meta: Meta = { ...(sender !== undefined && { sender }), ...(tags.length && { tags }), ...(title && { title }), ...(alt && { alt }), ...(name && { name }), ...(of !== undefined && { of }) };
  const draft = opts.draft === true;
  const { id, readId } = await store(feed, opts.id ?? newNoteId(), { ext, content: body, meta }, date, opts.wantedReadId, draft);
  logger("notes").info({ kind: type.name, bytes: body.length }, "note posted"); // never the feed, the id or the title
  notePosted(type.name);
  return { note: type.read({ id, ext, meta, date, size: body.length, draft }, Buffer.from(body)), readId };
}

export const MARKDOWN = typeForExt("md")!;
export const encoder = new TextEncoder();

/** A markdown note from its text. */
export async function createNote(feed: string, markdown: string, now = new Date(), sender?: string, tags: string[] = [], wantedReadId?: string, title?: string): Promise<{ note: MarkdownNote; readId: string | null }> {
  const made = await createNoteOf(feed, MARKDOWN, "md", encoder.encode(markdown), { sender, tags, title, wantedReadId }, now);
  return { note: made.note as MarkdownNote, readId: made.readId };
}

/** An image as a note of its own. The format is decided by the bytes (UnsupportedTypeError for anything else, SVG included). */
export async function createImageNote(feed: string, bytes: Uint8Array, opts: NewNoteOptions, now = new Date()): Promise<{ note: ImageNote; readId: string | null }> {
  const ext = sniffImage(bytes);
  if (!ext) throw new UnsupportedTypeError();
  const made = await createNoteOf(feed, typeForExt(ext)!, ext, bytes, opts, now);
  return { note: made.note as ImageNote, readId: made.readId };
}

type RefQuery = { upTo?: number; before?: string; limit?: number };

// The notes of the feed (of a type), newest first by date, ties by id; `q` as storage's listNoteRefs. A type filter asks storage for
// the whole list (images and texts interleave); so does a limited page that held a file that is no note (one placed by hand).
// Drafts (#265) only on the owner's paths, those without `upTo`: every reader's path has one, so it never lists a draft.
async function noteRefs(feed: string, typeName?: string, q: RefQuery = {}): Promise<NoteRef[]> {
  if (checkFeed(feed)) return [];
  // The feed's own title image (uploaded as one, not posted) is in no list: not the timeline, RSS, the APIs, counts or the free cap.
  const settings = await storage().readSettings(feed);
  const own = settings.ownImage ? settings.image : null;
  const isNote = (e: NoteRef) => { const type = typeForExt(e.ext); return !!type && (typeName === undefined || type.name === typeName) && isValidId(e.id) && `${e.id}.${e.ext}` !== own; };
  const limit = typeName === undefined ? q.limit : undefined;
  const drafts = q.upTo === undefined;
  const refs = await storage().listNoteRefs(feed, { upTo: q.upTo, before: q.before, limit, drafts });
  const notes = refs.filter(isNote);
  if (limit !== undefined && notes.length < refs.length) return (await storage().listNoteRefs(feed, { upTo: q.upTo, before: q.before, drafts })).filter(isNote).slice(0, q.limit);
  return q.limit === undefined ? notes : notes.slice(0, q.limit);
}

const log = logger("notes");

/**
 * A note whose stored copy did not decrypt (issue #212): the operator's to look into, so a line naming the note (its id, never the feed's
 * name or any content) and a counter. Throws anything else on.
 */
export function unreadableNote(id: string, e: unknown): UnreadableNoteError {
  if (!(e instanceof CipherError)) throw e;
  log.error({ note: id }, "a note could not be decrypted");
  noteUnreadable();
  return new UnreadableNoteError();
}

// Newest first by date. `before` (a note id) pages backwards: the notes after it in that order. A `before` that is gone (or past
// `asOf`) ends the list. `asOf`: only the notes dated then or earlier, what a reader sees; without it, scheduled notes too (the owner's).
// `tag`: only notes carrying it; newest first, the metadata of a chunk is read to choose and the notes themselves only for the
// matches, until `limit` match. A note whose stored copy can't be decrypted is left out, or with `placeholders` listed in its place as
// an UnreadableNote (the pages, the API and MCP show it; RSS can't); its tags can't be read, so a tag never matches it.
export async function listNotes(feed: string, limit = 50, before?: string, tag?: string, typeName?: string, placeholders = false, asOf?: Date): Promise<Note[]> {
  const refs = await noteRefs(feed, typeName, { upTo: asOf?.getTime(), before, ...(tag === undefined && { limit }) });
  const one = (ref: NoteRef): Promise<Note | null> =>
    readOf(feed, ref).catch((e) => {
      if (!(e instanceof UnreadableNoteError)) throw e;
      return placeholders ? new UnreadableNote(ref.id, ref.ext, new Date(ref.date), ref.draft) : null;
    });
  const read = async (page: NoteRef[]) => (await Promise.all(page.map(one))).filter((n) => n !== null); // null: deleted between the listing and the read
  if (tag === undefined) return read(refs.slice(0, limit));
  // ponytail: a rare tag reads every sidecar of the feed; a tag index would fix it if feeds get large.
  const found: Note[] = [];
  for (let i = 0; i < refs.length && found.length < limit; i += limit) {
    const chunk = refs.slice(i, i + limit);
    const metas = await Promise.all(chunk.map((ref) => storage().readMeta(feed, ref).catch((e) => (unreadableNote(ref.id, e), null))));
    found.push(...(await read(chunk.filter((_, j) => metas[j]?.tags?.includes(tag)))));
  }
  return found.slice(0, limit);
}

/** The ids of the notes of a type past the newest `keep`: the oldest ones, without reading any note's content. */
export async function idsBeyond(feed: string, keep: number, typeName?: string): Promise<string[]> {
  return (await noteRefs(feed, typeName)).slice(keep).map((r) => r.id);
}

/** `asOf`: only the notes dated then or earlier (what a reader sees). */
export async function countNotes(feed: string, typeName?: string, asOf?: Date): Promise<number> {
  return (await noteRefs(feed, typeName, { upTo: asOf?.getTime() })).length;
}

/** Whether the note is dated after `now`: stored, but hidden from readers until then. */
export const isScheduled = (n: Note, now = new Date()): boolean => n.date.getTime() > now.getTime();

/** Whether the note is a draft: stored, but hidden from readers until it is published (#265). */
export const isDraft = (n: Note): boolean => n.draft;

const FILE_RE = /^([A-Za-z0-9_-]{1,128})\.([A-Za-z0-9]{1,16})$/;

/** Whether `file` (`<id>.<ext>`) is an image note of this feed: the check before a title image points at it. `asOf`: dated then or earlier. */
export async function hasImageNote(feed: string, file: string, asOf?: Date): Promise<boolean> {
  const m = FILE_RE.exec(file);
  const note = m && !checkFeed(feed) ? await getNote(feed, m[1], asOf) : null;
  return note instanceof ImageNote && note.file === file;
}

/** The file (`<id>.<ext>`) of the newest note named `name` and dated `asOf` or earlier, which /r/<read id>/<name> serves (#250); null
 *  when there is none. Reads metadata only; a note whose metadata can't be read never matches. Deleting that note makes the one
 *  before it of the same name the newest again. */
export async function namedFile(feed: string, name: string, asOf: Date): Promise<string | null> {
  if (checkFeed(feed) || cleanName(name) !== name) return null;
  const refs = await noteRefs(feed, undefined, { upTo: asOf.getTime() });
  // ponytail: reads sidecars newest first until one matches, as a rare tag does; a name index would fix it if feeds get large.
  for (let i = 0; i < refs.length; i += READS_AT_ONCE) {
    const chunk = refs.slice(i, i + READS_AT_ONCE);
    const metas = await Promise.all(chunk.map((ref) => storage().readMeta(feed, ref).catch((e) => (unreadableNote(ref.id, e), null))));
    const j = metas.findIndex((m) => m?.name === name);
    if (j >= 0) return `${chunk[j].id}.${chunk[j].ext}`;
  }
  return null;
}

/** Whether a reader may have `file` (`<id>.<ext>`) of the feed: its note is there, no draft, and dated `asOf` or earlier. Reads no content. */
export async function fileVisible(feed: string, file: string, asOf: Date): Promise<boolean> {
  const m = FILE_RE.exec(file);
  const stored = m && !checkFeed(feed) && isValidId(m[1]) ? await storage().readNote(feed, m[1], [m[2]], () => false) : null;
  return stored !== null && !stored.draft && stored.date <= asOf.getTime();
}

// The note, found by trying `exts` (a lookup by id alone) or the one extension a listing already knows.
async function readNoteAs(feed: string, id: string, exts: readonly string[]): Promise<Note | null> {
  if (checkFeed(feed) || !isValidId(id)) return null;
  const stored = await storage().readNote(feed, id, exts, withContent).catch((e) => Promise.reject(unreadableNote(id, e)));
  const type = stored && typeForExt(stored.ext);
  return stored && type ? type.read({ id, ext: stored.ext, meta: stored.meta, date: new Date(stored.date), size: stored.size, draft: stored.draft }, stored.content) : null;
}

const readOf = (feed: string, ref: NoteRef) => readNoteAs(feed, ref.id, [ref.ext]);

/** Whether the operator removed this note (#159): its id answers 410 for good, while its mark is there and after. */
export async function isRemovedNote(feed: string, id: string): Promise<boolean> {
  return !checkFeed(feed) && isValidId(id) && (await storage().isRemovedNote(feed, id));
}

/** The same, as the refusal every read and edit of one note gives. */
export async function refuseRemovedNote(feed: string, id: string): Promise<void> {
  if (await isRemovedNote(feed, id)) throw new RemovedNoteError();
}

/** `asOf`: a reader's lookup; a note dated after it, or a draft, is null, as a missing one. */
export async function getNote(feed: string, id: string, asOf?: Date): Promise<Note | null> {
  const note = await readNoteAs(feed, id, NOTE_EXTS);
  return note && asOf && (isScheduled(note, asOf) || note.draft) ? null : note;
}

/**
 * Replaces a note's content with `body`, declared as `mediaType`. A note keeps its type, so the declared type must be the note's own
 * (UnsupportedTypeError otherwise); the body gets the checks a new note gets. Id, date and metadata stay. null: invalid feed or id, or no
 * such note.
 */
export async function replaceContent(feed: string, id: string, body: Uint8Array, mediaType: string): Promise<Note | null> {
  const parsed = parseMediaType(mediaType);
  if (!parsed) throw new UnsupportedTypeError();
  if (!parsed.type.verify(body, parsed.ext)) throw new UnsupportedTypeError(`the body is not ${parsed.mediaType}`);
  parsed.type.checkBody(body);
  if (checkFeed(feed) || !isValidId(id)) return null;
  const note = await getNote(feed, id);
  if (!note) return null;
  if (note.type !== parsed.mediaType) throw new UnsupportedTypeError(`this note is ${note.type}: send that Content-Type`);
  if (!(await storage().replaceNote(feed, id, NOTE_EXTS, body))) return null;
  noteEdited(parsed.type.name, "content");
  return getNote(feed, id);
}

/** Sets the title and/or alt text of a note; "" removes one. At least one is needed; alt only for types that have it. null: no such note. */
export async function changeMeta(feed: string, id: string, edit: { title?: string; alt?: string; tags?: string[] }): Promise<Note | null> {
  if (edit.title === undefined && edit.alt === undefined && edit.tags === undefined) throw new InvalidBodyError("nothing to change: send title, alt or tags");
  const title = checkLine("title", edit.title, MAX_NOTE_TITLE);
  const alt = checkLine("alt", edit.alt, MAX_ALT);
  const tags = edit.tags === undefined ? undefined : checkTags(edit.tags);
  if (checkFeed(feed) || !isValidId(id)) return null;
  const note = await getNote(feed, id);
  if (!note) return null;
  if (alt !== undefined && !typeForExt(note.ext)?.hasAlt) throw new InvalidBodyError("alt is for image notes");
  // Tags are replaced as a whole list, an empty one removes them (#244).
  const patch = { ...(title !== undefined && { title }), ...(alt !== undefined && { alt }), ...(tags !== undefined && { tags: tags.length ? tags : null }) };
  if (!(await storage().updateMeta(feed, id, NOTE_EXTS, patch))) return null;
  noteEdited(typeForExt(note.ext)?.name ?? "unknown", "meta");
  return getNote(feed, id);
}

/**
 * Gives a note a new date, and moves every note posted with it (an attachment, whose `of` is its id) by as much, so the attachments keep
 * their place just before the text. Id, content and metadata stay. InvalidBodyError for an invalid date. null: invalid feed or id, or no
 * such note.
 */
export async function changeDate(feed: string, id: string, date: Date): Promise<Note | null> {
  if (Number.isNaN(date.getTime())) throw new InvalidBodyError("date is not a valid date");
  if (checkFeed(feed) || !isValidId(id)) return null;
  const note = await getNote(feed, id);
  if (!note) return null;
  if (!(await storage().setDate(feed, id, NOTE_EXTS, date.getTime()))) return null;
  const shift = date.getTime() - note.date.getTime();
  await Promise.all((await attachmentsOf(feed, id)).map((ref) => storage().setDate(feed, ref.id, [ref.ext], Math.max(0, ref.date + shift))));
  return getNote(feed, id);
}

// The notes posted with the note `id` (their `of` is its id), drafts included.
// ponytail: reads every sidecar of the feed to find the attachments, as a rare tag does; an index of `of` would fix it if feeds get large.
async function attachmentsOf(feed: string, id: string): Promise<NoteRef[]> {
  const refs = (await noteRefs(feed)).filter((r) => r.id !== id);
  const found: NoteRef[] = [];
  for (let i = 0; i < refs.length; i += READS_AT_ONCE) {
    const chunk = refs.slice(i, i + READS_AT_ONCE);
    const metas = await Promise.all(chunk.map((ref) => storage().readMeta(feed, ref).catch((e) => (unreadableNote(ref.id, e), null))));
    found.push(...chunk.filter((_, j) => metas[j]?.of === id));
  }
  return found;
}

/**
 * Makes a note a draft or publishes it, and every note posted with it (an attachment, whose `of` is its id) along with it, so a draft's
 * pictures never reach a reader before its text (#265). Dates, content and metadata stay. null: invalid feed or id, or no such note.
 */
export async function changeDraft(feed: string, id: string, draft: boolean): Promise<Note | null> {
  if (checkFeed(feed) || !isValidId(id)) return null;
  if (!(await storage().setDraft(feed, id, NOTE_EXTS, draft))) return null;
  for (const ref of await attachmentsOf(feed, id)) await storage().setDraft(feed, ref.id, [ref.ext], draft);
  return getNote(feed, id);
}

/** `reason`: a writer deleted it, or the free tier dropped it past the cap (backend/licensing.ts); for the metrics only. */
export async function removeNote(feed: string, id: string, reason: "deleted" | "free_cap" = "deleted"): Promise<boolean> {
  if (checkFeed(feed) || !isValidId(id)) return false;
  // Asked per kind, so the log can say which kind went (the storage only says whether something did).
  let removed = false;
  for (const type of NOTE_TYPES) {
    if (!(await storage().deleteNote(feed, id, type.exts))) continue;
    removed = true;
    logger("notes").info({ kind: type.name }, "note deleted");
    noteDeleted(type.name, reason);
  }
  return removed;
}
