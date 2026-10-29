// A note on disk is a content file `<DATA_DIR>/<feed>/<id>.<ext>`, stored exactly as posted, and a sidecar with its metadata and
// its date, `.<id>.<ext>.json` (the content file's complete name plus `.json`; `{ ...meta, date }`, and `draft: true` for a draft, #265). A note placed by hand, or
// stored before notes had a date, may have no sidecar or one without a date. Dot files are never notes. Which
// extensions are notes is the caller's business (backend/note/types.ts); nothing here knows about types.
// Only regular files count: a folder, a symbolic link or an unreadable entry in a feed folder is "not a note", never an error.
import { randomBytes } from "node:crypto";
import type { Stats } from "node:fs";
import { appendFile, link, lstat, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { countDir, countFile, noteFeedSize } from "../../metrics";
import { applyPatch, hasMeta, parseMeta } from "../meta";
import { FeedGoneError, type FeedUsage, type Meta, type NoteRef, type StoredNote } from "../types";
import { feedDir, isErrno } from "./fs";

const NAME_RE = /^([A-Za-z0-9_-]{1,128})\.([A-Za-z0-9]{1,16})$/;
const READS_AT_ONCE = 64;
const file = (feed: string, id: string, ext: string) => join(feedDir(feed), `${id}.${ext}`);
const sidecar = (feed: string, id: string, ext: string) => join(feedDir(feed), `.${id}.${ext}.json`);

// What a hand-placed oddity (a folder where a file should be, a link, a file we may not read) comes to: nothing there.
const GONE = ["ENOENT", "ENOTDIR", "EISDIR", "EACCES", "ELOOP", "EPERM"];
const isGone = (e: unknown) => GONE.some((c) => isErrno(e, c));

async function regular(path: string): Promise<Stats | null> {
  try {
    const info = await lstat(/*turbopackIgnore: true*/ path);
    return info.isFile() ? info : null;
  } catch (e) {
    if (isGone(e)) return null;
    throw e;
  }
}

async function readRegular(path: string): Promise<Buffer | null> {
  if (!(await regular(path))) return null;
  countFile();
  try {
    return await readFile(/*turbopackIgnore: true*/ path);
  } catch (e) {
    if (isGone(e)) return null;
    throw e;
  }
}

// The sidecar's text, null when there is none.
async function sidecarOf(feed: string, id: string, ext: string): Promise<string | null> {
  return (await readRegular(sidecar(feed, id, ext)))?.toString("utf8") ?? null;
}

async function metaOf(feed: string, id: string, ext: string): Promise<Meta> {
  const raw = await sidecarOf(feed, id, ext);
  return raw === null ? {} : parseMeta(raw);
}

// The date the sidecar holds, undefined when it holds none (or no sidecar).
function storedDate(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  try {
    const date = (JSON.parse(raw) as { date?: unknown } | null)?.date;
    return typeof date === "number" && Number.isFinite(date) ? date : undefined;
  } catch {
    return undefined;
  }
}

// Whether the sidecar marks the note a draft; anything but `true` (or no sidecar) is published.
function storedDraft(raw: string | null): boolean {
  if (raw === null) return false;
  try {
    return (JSON.parse(raw) as { draft?: unknown } | null)?.draft === true;
  } catch {
    return false;
  }
}

// The sidecar's plain fields beside the metadata: the date, and the draft flag only when set.
const plain = (date: number, draft: boolean) => ({ date, ...(draft && { draft: true }) });

// A note's date: the sidecar's, else the metadata's `created`, else when the content was last written.
function dateOf(raw: string | null, meta: Meta, mtime: number): number {
  const created = meta.created === undefined ? NaN : Date.parse(meta.created);
  return storedDate(raw) ?? (Number.isNaN(created) ? Math.floor(mtime) : created);
}

// Writes the sidecar atomically (temp file, then rename over it). False when the feed is gone.
async function writeSidecar(feed: string, id: string, ext: string, json: string): Promise<boolean> {
  const tmp = join(feedDir(feed), `.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(/*turbopackIgnore: true*/ tmp, json);
    await rename(/*turbopackIgnore: true*/ tmp, sidecar(feed, id, ext));
    return true;
  } catch (e) {
    if (isErrno(e, "ENOENT")) return false; // the feed was deleted since the read
    throw e;
  } finally {
    await unlink(/*turbopackIgnore: true*/ tmp).catch(() => {});
  }
}

// The content file of a note, whichever of the accepted extensions it has: a few lstat calls, never a listing of the folder.
async function find(feed: string, id: string, exts: readonly string[]): Promise<{ ext: string; path: string; info: Stats } | null> {
  for (const ext of exts) {
    const path = file(feed, id, ext);
    const info = await regular(path);
    if (info) return { ext, path, info };
  }
  return null;
}

// Stores `content` as `<base>.<ext>`, or `<base>-2.<ext>`, `-3`, … if taken; returns the id used. The sidecar is written
// first, so a listed note always has its metadata and date; a failure removes it again. The feed directory must exist (ensureFeed
// creates it): a feed deleted meanwhile is FeedGoneError, never a directory made again without its `.readid`.
// Never overwrites, never leaves a partial content file behind.
export async function writeNote(feed: string, base: string, ext: string, content: string | Uint8Array, meta: Meta, date: number, draft = false): Promise<string> {
  const dir = feedDir(feed);
  const tmp = join(dir, `.${randomBytes(6).toString("hex")}.tmp`);
  const json = JSON.stringify({ ...meta, ...plain(date, draft) });
  try {
    await writeFile(/*turbopackIgnore: true*/ tmp, content);
    for (let n = 1; ; n++) {
      const id = n === 1 ? base : `${base}-${n}`;
      if (!(await claim(feed, id, ext, json))) continue;
      try {
        // link() fails with EEXIST instead of overwriting, so the final name appears atomically and exclusively.
        await link(/*turbopackIgnore: true*/ tmp, file(feed, id, ext));
        return id;
      } catch (e) {
        await unlink(/*turbopackIgnore: true*/ sidecar(feed, id, ext)).catch(() => {});
        if (!isErrno(e, "EEXIST")) throw e;
      }
    }
  } catch (e) {
    throw isErrno(e, "ENOENT") ? new FeedGoneError() : e;
  } finally {
    await unlink(/*turbopackIgnore: true*/ tmp).catch(() => {});
  }
}

// A new note's sidecar, written only if none is there: it claims the id. False when one already does.
async function claim(feed: string, id: string, ext: string, json: string): Promise<boolean> {
  try {
    await writeFile(/*turbopackIgnore: true*/ sidecar(feed, id, ext), json, { flag: "wx" });
    return true;
  } catch (e) {
    if (isErrno(e, "EEXIST")) return false;
    throw e;
  }
}

// Every regular file of the feed that could be a note: `<id>.<ext>`, no dot at the start, one dot.
async function namesIn(feed: string): Promise<{ id: string; ext: string }[]> {
  countDir();
  let entries;
  try {
    entries = await readdir(/*turbopackIgnore: true*/ feedDir(feed), { withFileTypes: true });
  } catch (e) {
    if (isGone(e)) return [];
    throw e;
  }
  // Dirent.isFile() is false for a folder and for a symbolic link.
  return entries.flatMap((e) => {
    const m = e.isFile() ? NAME_RE.exec(e.name) : null;
    return m ? [{ id: m[1], ext: m[2] }] : [];
  });
}

// The caller filters by type. Each note's sidecar is read for its date (a note without one, its content file's mtime); the order,
// `upTo`, `drafts`, `before` and `limit` are then applied here, in memory.
export async function listNoteRefs(feed: string, q: { upTo?: number; before?: string; limit?: number; drafts?: boolean; removed?: boolean } = {}): Promise<NoteRef[]> {
  // A note the operator removed is in no list, also while a takedown cut short has not deleted it yet (#159); the mark, which has
  // the id of the text it stands for, is.
  const [all, removed] = await Promise.all([namesIn(feed), q.removed ? new Map() : removedNotes(feed)]);
  const names = removed.size ? all.filter((n) => n.ext === "removed" || !removed.has(n.id)) : all;
  noteFeedSize(names.length);
  const dateRef = async ({ id, ext }: { id: string; ext: string }): Promise<NoteRef | null> => {
    const raw = await sidecarOf(feed, id, ext);
    const stored = storedDate(raw);
    const draft = storedDraft(raw);
    if (stored !== undefined) return { id, ext, date: stored, draft };
    const info = await regular(file(feed, id, ext));
    return info && { id, ext, date: dateOf(raw, raw === null ? {} : parseMeta(raw), info.mtimeMs), draft }; // null: gone since the listing
  };
  // READS_AT_ONCE sidecars at a time: a read per note under one Promise.all runs out of file descriptors on a large feed (as feedindex.ts).
  const dated: (NoteRef | null)[] = [];
  for (let i = 0; i < names.length; i += READS_AT_ONCE) dated.push(...(await Promise.all(names.slice(i, i + READS_AT_ONCE).map(dateRef))));
  let refs = dated.filter((r): r is NoteRef => r !== null && (q.upTo === undefined || r.date <= q.upTo) && (q.drafts === true || !r.draft));
  refs.sort((a, b) => b.date - a.date || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  if (q.before !== undefined) {
    const at = refs.findIndex((r) => r.id === q.before);
    refs = at < 0 ? [] : refs.slice(at + 1);
  }
  return q.limit === undefined ? refs : refs.slice(0, q.limit);
}

/** Whether the feed has a note: a listing, no sidecar read. */
export async function hasNotes(feed: string): Promise<boolean> {
  return (await namesIn(feed)).length > 0;
}

/** A feed's notes per extension, with their bytes and the newest write, for the operator's metrics: a listing and an lstat per note. */
export async function noteUsage(feed: string): Promise<Pick<FeedUsage, "notes" | "lastWrite">> {
  const notes: FeedUsage["notes"] = {};
  let lastWrite: number | null = null;
  for (const { id, ext } of await namesIn(feed)) {
    const info = await regular(file(feed, id, ext));
    if (!info) continue;
    const n = (notes[ext] ??= { count: 0, bytes: 0 });
    n.count++;
    n.bytes += info.size;
    lastWrite = Math.max(lastWrite ?? 0, info.mtimeMs);
  }
  return { notes, lastWrite };
}

// `withContent` says for an extension whether the bytes are wanted: a picture is only listed, so reading it whole would cost its size
// for nothing; `content` is then empty and `size` (from the file system) is still right.
export async function readNote(feed: string, id: string, exts: readonly string[], withContent: (ext: string) => boolean): Promise<StoredNote | null> {
  const found = await find(feed, id, exts);
  if (!found) return null;
  const content = withContent(found.ext) ? await readRegular(found.path) : Buffer.alloc(0);
  if (content === null) return null;
  const raw = await sidecarOf(feed, id, found.ext);
  const meta = raw === null ? {} : parseMeta(raw);
  return { ext: found.ext, content, size: found.info.size, meta, mtime: found.info.mtime, date: dateOf(raw, meta, found.info.mtimeMs), draft: storedDraft(raw) };
}

// Only the sidecar: what the tag filter needs. null when the note itself is not there.
export async function readMeta(feed: string, ref: Pick<NoteRef, "id" | "ext">): Promise<Meta | null> {
  return (await regular(file(feed, ref.id, ref.ext))) ? metaOf(feed, ref.id, ref.ext) : null;
}

// A file of the feed by its name (`<stem>.<ext>`, no dot at the start): the bytes of a regular file, null for anything else. A
// symbolic link is not followed, so nothing outside the feed folder is reachable.
export async function readFeedFile(feed: string, name: string): Promise<Buffer | null> {
  return NAME_RE.test(name) ? readRegular(join(feedDir(feed), name)) : null;
}

// Replaces an existing note's content atomically (temp file, then rename over it); the sidecar is not touched. False, and
// nothing created, when there is no such note. ponytail: a delete landing between the lookup and the rename
// brings the note back with the edit; a per-feed lock would close it.
export async function replaceNote(feed: string, id: string, exts: readonly string[], content: string | Uint8Array): Promise<boolean> {
  const found = await find(feed, id, exts);
  if (!found) return false;
  const tmp = join(feedDir(feed), `.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(/*turbopackIgnore: true*/ tmp, content);
    await rename(/*turbopackIgnore: true*/ tmp, found.path);
    return true;
  } catch (e) {
    if (isErrno(e, "ENOENT")) return false; // the feed was deleted since the lookup
    throw e;
  } finally {
    await unlink(/*turbopackIgnore: true*/ tmp).catch(() => {});
  }
}

// Changes some fields of an existing note's metadata: a string or list sets one, null (or an empty value) removes it. The sidecar is
// replaced atomically (temp file, then rename), its date and draft flag kept; it is removed when nothing is left, not even a date. False when there
// is no such note.
export async function updateMeta(feed: string, id: string, exts: readonly string[], patch: { [K in keyof Meta]?: Meta[K] | null }): Promise<boolean> {
  const found = await find(feed, id, exts);
  if (!found) return false;
  const raw = await sidecarOf(feed, id, found.ext);
  const merged = applyPatch(raw === null ? {} : parseMeta(raw), patch);
  const date = storedDate(raw);
  const draft = storedDraft(raw);
  if (!hasMeta(merged) && date === undefined && !draft) {
    try {
      await unlink(/*turbopackIgnore: true*/ sidecar(feed, id, found.ext));
    } catch (e) {
      if (!isErrno(e, "ENOENT")) throw e;
    }
    return true;
  }
  return writeSidecar(feed, id, found.ext, JSON.stringify(date === undefined ? { ...merged, ...(draft && { draft: true }) } : { ...merged, ...plain(date, draft) }));
}

// Rewrites the sidecar with the new date, its metadata and draft flag kept, as updateMeta does. False when there is no such note.
export async function setDate(feed: string, id: string, exts: readonly string[], date: number): Promise<boolean> {
  const found = await find(feed, id, exts);
  if (!found) return false;
  const raw = await sidecarOf(feed, id, found.ext);
  return writeSidecar(feed, id, found.ext, JSON.stringify({ ...(raw === null ? {} : parseMeta(raw)), ...plain(date, storedDraft(raw)) }));
}

// Rewrites the sidecar with the flag, its metadata and date kept (a note without a stored date gets the one it is listed by, so the
// rewrite does not move it). False when there is no such note.
export async function setDraft(feed: string, id: string, exts: readonly string[], draft: boolean): Promise<boolean> {
  const found = await find(feed, id, exts);
  if (!found) return false;
  const raw = await sidecarOf(feed, id, found.ext);
  const meta = raw === null ? {} : parseMeta(raw);
  return writeSidecar(feed, id, found.ext, JSON.stringify({ ...meta, ...plain(dateOf(raw, meta, found.info.mtimeMs), draft) }));
}

// As writeNote: the new sidecar first (it claims the id, with the note's date written out), then a link of the content file to the
// new name; then the old pair goes, content first, as in deleteNote. A crash in between leaves the note under both ids, never under none.
// False when there is no such note, or the new id is taken (by a note of any extension, or a sidecar with its content).
// ponytail: a note written under the new id with another extension between the check and the link is not seen; only the migration
// renames, before requests.
export async function renameNote(feed: string, id: string, ext: string, newId: string): Promise<boolean> {
  const from = file(feed, id, ext);
  const info = await regular(from);
  if (!info || (await namesIn(feed)).some((n) => n.id === newId)) return false;
  const raw = await sidecarOf(feed, id, ext);
  const meta = raw === null ? {} : parseMeta(raw);
  const json = JSON.stringify({ ...meta, ...plain(dateOf(raw, meta, info.mtimeMs), storedDraft(raw)) });
  let claimed: boolean;
  try {
    claimed = await claim(feed, newId, ext, json);
    // A sidecar under the new id without its content is a rename cut short before its link (only the migration renames): taken over.
    if (!claimed && ((await regular(file(feed, newId, ext))) || !(await writeSidecar(feed, newId, ext, json)))) return false;
  } catch (e) {
    if (isErrno(e, "ENOENT")) return false; // the feed was deleted since the lookup
    throw e;
  }
  try {
    await link(/*turbopackIgnore: true*/ from, file(feed, newId, ext));
  } catch (e) {
    // A sidecar taken over may be another rename's of the same note, whose link came first: it stays with that content.
    if (claimed) await unlink(/*turbopackIgnore: true*/ sidecar(feed, newId, ext)).catch(() => {});
    if (isErrno(e, "EEXIST") || isErrno(e, "ENOENT")) return false; // taken, or the note was deleted meanwhile
    throw e;
  }
  await deleteNote(feed, id, [ext]);
  return true;
}

// Content first, then the sidecar: a sidecar left behind is ignored, content without its metadata would be shown bare.
export async function deleteNote(feed: string, id: string, exts: readonly string[]): Promise<boolean> {
  const found = await find(feed, id, exts);
  if (!found) return false;
  let gone = true;
  try {
    await unlink(/*turbopackIgnore: true*/ found.path);
  } catch (e) {
    if (!isErrno(e, "ENOENT")) throw e;
    gone = false;
  }
  await unlink(/*turbopackIgnore: true*/ sidecar(feed, id, found.ext)).catch((e) => {
    if (!isErrno(e, "ENOENT")) throw e;
  });
  return gone;
}

// The takedown of one post (issue #159): `.removed-notes` in the feed folder holds one JSON line per removed note (its id, and its
// post's date and draft flag), appended to (a line is small, and append is atomic for one). A dot file is never a note, and the folder
// goes with the feed. The tombstones first, then the notes, then the mark, as in the database backends. The first line of an id holds.
const removedNotesFile = (feed: string) => join(feedDir(feed), ".removed-notes");

export async function takedownNotes(feed: string, notes: { id: string; ext: string }[], post: { date: number; draft: boolean }, markId: string | null): Promise<{ keys: string[] }> {
  if (notes.length > 0) {
    try {
      await appendFile(/*turbopackIgnore: true*/ removedNotesFile(feed), notes.map((n) => JSON.stringify({ id: n.id, date: post.date, draft: post.draft }) + "\n").join(""), { mode: 0o600 });
    } catch (e) {
      if (isErrno(e, "ENOENT")) throw new FeedGoneError();
      throw e;
    }
    for (const n of notes) await deleteNote(feed, n.id, [n.ext]);
  }
  if (markId) await writeNote(feed, markId, "removed", "", {}, post.date, post.draft);
  return { keys: [] };
}

// Every tombstone of the feed by id, the first line of an id holding. A line cut short by a crash is not a record.
async function removedNotes(feed: string): Promise<Map<string, { date: number; draft: boolean }>> {
  const raw = await readFile(/*turbopackIgnore: true*/ removedNotesFile(feed), "utf8").catch((e) => {
    if (isGone(e)) return "";
    throw e;
  });
  const stones = new Map<string, { date: number; draft: boolean }>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const t = JSON.parse(line);
      if (typeof t.id === "string" && !stones.has(t.id)) stones.set(t.id, { date: Number(t.date) || 0, draft: t.draft === true });
    } catch {
      // cut short
    }
  }
  return stones;
}

export async function removedNote(feed: string, id: string): Promise<{ date: number; draft: boolean } | null> {
  return (await removedNotes(feed)).get(id) ?? null;
}
