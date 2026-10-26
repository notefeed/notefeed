// Notes had ids `<stamp>-<uuid v7>` (and `-2`, `-3`, … when taken) that carried their time; now an id is opaque and the date is the
// note's own (ADR 0042). Run once at start (startup.ts), before requests are served: every note with an old id gets its date from it
// and a new id derived from feed and old id, so a run cut short, or a second one beside it, computes the same ids again and a note
// already moved is skipped. Then each text's references to its feed's files follow. The log has counts only: a feed's name is its secret.
import { createHmac } from "node:crypto";
import { logger } from "./log";
import { typeForExt } from "./note/types";
import { secret } from "./secret";
import { storage } from "./storage";
import { CipherError } from "./storage/cipher";
import { OLD_ID } from "./storage/oldid";
import type { NoteRef } from "./storage/types";

// An old id as a file name in a text, `<old id>.<ext>`, not part of a longer name.
const OLD_FILE = /(?<![A-Za-z0-9_-])(\d{8}T\d{6}Z-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:-\d+)?)\.([A-Za-z0-9]{1,16})(?![A-Za-z0-9])/gi;
// A text's pictures were stored just before it, in the same post.
const POSTED_WITH = 60_000;

/** The id a note with the old id `oldId` gets: an HMAC of feed and old id under the instance secret, 22 characters of base64url. */
export const migratedId = (feed: string, oldId: string): string => createHmac("sha256", secret()).update(`note-id:${feed}:${oldId}`).digest("base64url").slice(0, 22);

// The old id's time: the uuid v7's milliseconds, else the stamp's second. null: not an old id.
function oldDate(id: string): number | null {
  const m = OLD_ID.exec(id);
  if (!m) return null;
  if (m[8] === "7") return parseInt(m[7].replace(/-/g, "").slice(0, 12), 16);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

const isImage = (ext: string) => typeForExt(ext)?.name === "image";
const isText = (ext: string) => typeForExt(ext)?.name === "markdown";
// How often a text is read, rewritten and read back before it is left as it is: each round follows a run beside this one.
const ROUNDS = 5;

// What did not move, for the log. `unreadable`: notes sealed under a key this instance cannot open; `stuck`: notes still under their
// old ids once a feed's notes are moved (unreadable, or moved by a run beside this one just then).
type Left = { unreadable: number; stuck: number };

// A note this instance cannot open stays as it is: it cannot be shown either way, and must not stop the start.
async function unlessUnreadable<T>(op: () => Promise<T>, left: Left): Promise<T | null> {
  try {
    return await op();
  } catch (e) {
    if (!(e instanceof CipherError)) throw e;
    left.unreadable++;
    return null;
  }
}

const byName = (refs: NoteRef[]) => new Map(refs.map((r) => [`${r.id}.${r.ext}`, r]));

// renameNote found the new id taken: by this very note, moved by a run beside this one (two database instances starting together),
// or left under both ids by a file system rename cut short after its link. Either way the new one is it, and the old one goes if it
// is still there. True when this call removed it. (A rename cut short before its link is renameNote's own: it takes the sidecar over.)
async function settleTaken(feed: string, ref: NoteRef, newId: string, left: Left): Promise<boolean> {
  const s = storage();
  return !!(await unlessUnreadable(() => s.readNote(feed, newId, [ref.ext], () => false), left)) && (await s.deleteNote(feed, ref.id, [ref.ext]));
}

// A note with an old id: its date from the id, then its new id. True when it moved in this call.
async function move(feed: string, ref: NoteRef, date: number, left: Left): Promise<boolean> {
  const s = storage();
  const newId = migratedId(feed, ref.id);
  await s.setDate(feed, ref.id, [ref.ext], date);
  const moved = await unlessUnreadable(() => s.renameNote(feed, ref.id, ref.ext, newId), left);
  return moved === false ? settleTaken(feed, ref, newId, left) : !!moved;
}

// A text's references to its feed's files under their old ids, each that has its new name in `names` swapped for it. Only the feed's
// own files: an old id that is not one of them (a link into another feed) stays as written. `pending`: the old names still listed.
function follow(feed: string, text: string, names: Map<string, NoteRef>): { after: string; pictures: NoteRef[]; pending: string[] } {
  const pictures: NoteRef[] = [];
  const pending: string[] = [];
  const after = text.replace(OLD_FILE, (whole, old: string, ext: string) => {
    if (names.has(`${old}.${ext}`)) pending.push(`${old}.${ext}`);
    const ref = names.get(`${migratedId(feed, old)}.${ext}`);
    if (!ref) return whole;
    if (isImage(ref.ext)) pictures.push(ref);
    return `${ref.id}.${ref.ext}`;
  });
  return { after, pictures, pending };
}

// Rewrites one text, and reads it back: a run beside this one that read it earlier may write its own, older rewrite over this one,
// and a file still under its old id may be moved by that run meanwhile. So: again, with a fresh listing, until the text holds still.
// True when this call wrote it.
async function rewriteText(feed: string, t: NoteRef, names: Map<string, NoteRef>, left: Left): Promise<boolean> {
  const s = storage();
  const read = async () => (await unlessUnreadable(() => s.readNote(feed, t.id, [t.ext], () => true), left))?.content.toString("utf8") ?? null;
  let wrote = false;
  for (let round = 0; round < ROUNDS; round++) {
    const before = await read();
    if (before === null) return wrote;
    const { after, pictures, pending } = follow(feed, before, names);
    if (after !== before) {
      // The pictures first: once the text is rewritten, a rerun no longer finds them in it.
      for (const p of pictures) {
        if (p.date < t.date - POSTED_WITH || p.date >= t.date) continue;
        const meta = await unlessUnreadable(() => s.readMeta(feed, p), left);
        if (meta && meta.of !== t.id) await unlessUnreadable(() => s.updateMeta(feed, p.id, [p.ext], { of: t.id }), left);
      }
      if (!(await s.replaceNote(feed, t.id, [t.ext], after))) return wrote;
      wrote = true;
    }
    if ((await read()) !== after) continue; // written over meanwhile
    if (pending.length === 0) return wrote;
    const fresh = byName(await s.listNoteRefs(feed));
    if (pending.every((n) => fresh.has(n))) return wrote; // stuck: they stay under their old ids, and their references as written
    names = fresh;
  }
  return wrote;
}

// A note without an old id gets a date of its own, the one it reads with now: a database row from before notes had a date reads as 0
// and gets the time it was last written, as on the file system; a file placed by hand without a stored date reads with its mtime,
// which its next write would move, so that date is stored. (On a database the same date is then written again: once, harmless.)
async function keepDate(feed: string, ref: NoteRef, left: Left): Promise<void> {
  const s = storage();
  await unlessUnreadable(async () => {
    const note = await s.readNote(feed, ref.id, [ref.ext], () => false);
    if (!note) return;
    if (ref.date === 0) await s.setDate(feed, ref.id, [ref.ext], note.mtime.getTime());
    else if (note.date === Math.floor(note.mtime.getTime())) await s.setDate(feed, ref.id, [ref.ext], note.date);
  }, left);
}

// The feed's title image is named in its settings by its file, `<old id>.<ext>`: it follows its note to the new name, if that is one
// of the feed's notes. True when the settings changed.
async function followTitleImage(feed: string, names: Map<string, NoteRef>, left: Left): Promise<boolean> {
  const s = storage();
  const changed = await unlessUnreadable(async () => {
    const settings = await s.readSettings(feed);
    const m = /^(.+)\.([A-Za-z0-9]{1,16})$/.exec(settings.image);
    if (!m || oldDate(m[1]) === null) return false;
    const image = `${migratedId(feed, m[1])}.${m[2]}`;
    if (!names.has(image)) return false;
    await s.writeSettings(feed, { ...settings, image });
    return true;
  }, left);
  return !!changed;
}

// One feed: how many notes got their new id and how many texts were rewritten; `titled`: its title image was renamed.
async function migrateFeed(feed: string, left: Left): Promise<{ renamed: number; rewritten: number; titled: boolean }> {
  const s = storage();
  let renamed = 0;
  for (const ref of await s.listNoteRefs(feed)) {
    const date = oldDate(ref.id);
    if (date === null) await keepDate(feed, ref, left);
    else if (await move(feed, ref, date, left)) renamed++;
  }
  const notes = await s.listNoteRefs(feed);
  left.stuck += notes.filter((r) => oldDate(r.id) !== null).length;
  const names = byName(notes);
  const titled = await followTitleImage(feed, names, left);
  let rewritten = 0;
  for (const t of notes.filter((r) => isText(r.ext))) if (await rewriteText(feed, t, names, left)) rewritten++;
  return { renamed, rewritten, titled };
}

/** Moves every feed's notes from old ids to derived ones (see above). `feeds`: those in which something changed. A pass that left no
 *  note under its old id is marked in the storage, and from then on there is no pass: a start reads nothing. Without the mark (a
 *  crash after the last rename, before the texts were rewritten; a note stuck) the next start makes the whole pass again. A store
 *  without notes needs none and is marked at once. */
export async function migrateNoteIds(): Promise<{ feeds: number; renamed: number; rewritten: number }> {
  const s = storage();
  const total = { feeds: 0, renamed: 0, rewritten: 0 };
  if (!(await s.migrationPending())) {
    await s.markMigrated();
    return total;
  }
  const left: Left = { unreadable: 0, stuck: 0 };
  for (const feed of await s.listFeeds()) {
    const { renamed, rewritten, titled } = await migrateFeed(feed, left);
    if (renamed || rewritten || titled) total.feeds++;
    total.renamed += renamed;
    total.rewritten += rewritten;
  }
  if (left.stuck === 0) await s.markMigrated();
  try {
    if (total.feeds) logger("startup").info(total, "notes moved to ids of their own");
    if (left.stuck || left.unreadable) logger("startup").warn(left, "notes left under their old ids; references to them stay as written");
  } catch {}
  return total;
}
