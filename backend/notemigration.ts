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
import type { NoteRef } from "./storage/types";

// Group 7 is the uuid, 8 its version.
const OLD_ID = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-([0-9a-f]{8}-[0-9a-f]{4}-([0-9a-f])[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12})(?:-\d+)?$/i;
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

// A note sealed under a key this instance cannot open stays as it is: it cannot be shown either way, and must not stop the start.
async function unlessUnreadable<T>(op: () => Promise<T>, skipped: { n: number }): Promise<T | null> {
  try {
    return await op();
  } catch (e) {
    if (!(e instanceof CipherError)) throw e;
    skipped.n++;
    return null;
  }
}

// One feed: returns how many notes got their new id and how many texts were rewritten.
async function migrateFeed(feed: string, skipped: { n: number }): Promise<{ renamed: number; rewritten: number }> {
  const s = storage();
  let renamed = 0;
  for (const ref of await s.listNoteRefs(feed)) {
    const date = oldDate(ref.id);
    if (date === null) {
      // A database row from before notes had a date reads as 0: it gets the time it was last written, as on the file system.
      if (ref.date === 0) await unlessUnreadable(async () => {
        const note = await s.readNote(feed, ref.id, [ref.ext], () => false);
        if (note) await s.setDate(feed, ref.id, [ref.ext], note.mtime.getTime());
      }, skipped);
      continue;
    }
    const newId = migratedId(feed, ref.id);
    await s.setDate(feed, ref.id, [ref.ext], date);
    const moved = await unlessUnreadable(() => s.renameNote(feed, ref.id, ref.ext, newId), skipped);
    if (moved) renamed++;
    // Taken: moved by a run beside this one (two database instances starting together), or a rename cut short that left the note
    // under both ids (file system). Either way the new one is it; the old one goes, if it is still there.
    else if (moved === false && (await unlessUnreadable(() => s.readNote(feed, newId, [ref.ext], () => false), skipped)) && (await s.deleteNote(feed, ref.id, [ref.ext]))) renamed++;
  }

  const notes = await s.listNoteRefs(feed);
  const byName = new Map(notes.map((r) => [`${r.id}.${r.ext}`, r]));
  let rewritten = 0;
  for (const t of notes.filter((r) => isText(r.ext))) {
    const note = await unlessUnreadable(() => s.readNote(feed, t.id, [t.ext], () => true), skipped);
    if (!note) continue;
    const before = note.content.toString("utf8");
    const pictures: NoteRef[] = [];
    let pending = false;
    // Only the feed's own files: an old id that is not one of them (a link into another feed) stays as written.
    const after = before.replace(OLD_FILE, (whole, old: string, ext: string) => {
      pending ||= byName.has(`${old}.${ext}`);
      const ref = byName.get(`${migratedId(feed, old)}.${ext}`);
      if (!ref) return whole;
      if (isImage(ref.ext)) pictures.push(ref);
      return `${ref.id}.${ref.ext}`;
    });
    // A file still under its old id is being moved by a run beside this one: a text written now would miss it, and could land after
    // that run's complete one. That run rewrites the text once it has moved them all.
    if (pending || after === before) continue;
    // The pictures first: once the text is rewritten, a rerun no longer finds them in it.
    for (const p of pictures) {
      if (p.date < t.date - POSTED_WITH || p.date >= t.date) continue;
      const meta = await unlessUnreadable(() => s.readMeta(feed, p), skipped);
      if (meta && meta.of !== t.id) await unlessUnreadable(() => s.updateMeta(feed, p.id, [p.ext], { of: t.id }), skipped);
    }
    if (await s.replaceNote(feed, t.id, [t.ext], after)) rewritten++;
  }
  return { renamed, rewritten };
}

/** Moves every feed's notes from old ids to derived ones (see above). `feeds`: those in which something changed. */
export async function migrateNoteIds(): Promise<{ feeds: number; renamed: number; rewritten: number }> {
  const total = { feeds: 0, renamed: 0, rewritten: 0 };
  const skipped = { n: 0 };
  for (const feed of await storage().listFeeds()) {
    const { renamed, rewritten } = await migrateFeed(feed, skipped);
    if (renamed || rewritten) total.feeds++;
    total.renamed += renamed;
    total.rewritten += rewritten;
  }
  try {
    if (total.feeds) logger("startup").info(total, "notes moved to ids of their own");
    if (skipped.n) logger("startup").warn({ notes: skipped.n }, "notes this instance cannot open keep their old ids");
  } catch {}
  return total;
}
