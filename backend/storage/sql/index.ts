// The database backend: SQLite and PostgreSQL through Kysely, one implementation for both. The database is the only source of truth
// (no in-memory index): uniqueness is a constraint, counts are queries, so several containers stay consistent.
import { sql, type Kysely } from "kysely";
import { keyServiceDown, NotFoundError, ReadIdTakenError, RemovedFeedError } from "../../errors";
import { logger } from "../../log";
import { noteFeedSize } from "../../metrics";
import { newKey, type ImageStore } from "../images/types";
import { applyPatch, hasMeta, parseMeta } from "../meta";
import { parseSettings, serializeSettings } from "../settings";
import { FeedGoneError, type FeedUsage, type Meta, type Storage } from "../types";
import { IMAGE_EXTS } from "../../../shared/images";
import { CipherError, open as openBytes, openText, seal, sealText, type FingerprintKind } from "../cipher";
import type { KeyWrapper } from "../wrapper";
import { KeyringError, openKeyring, type Keyring } from "./keyring";
import { migrate, type Kind } from "./migrations";
import type { Schema } from "./schema";

export type SqlStorage = Storage & {
  close(): Promise<void>;
  /**
   * The operator's clean-up: the objects in the image store that no note names, and, with `remove`, their deletion. An object written
   * less than `olderThanMs` ago is left alone and only counted (`tooRecent`): its note's row may not be there yet. `missing` counts
   * the notes whose object is not in the store. null: this instance has no image store.
   */
  sweepImages(o: { remove: boolean; olderThanMs: number }): Promise<Sweep | null>;
  /**
   * The operator's move of image bytes into the configured store (issue #128): from the rows (`from` "db") or from another store, at
   * most `limit` notes per call, newest first, from behind the cursor `after` (the previous call's `next`); `left` says how many rows
   * are still to look at. Each note is moved whole and in a safe order (the new copy first, the row next, the old bytes last), so a run
   * can stop anywhere and start again. A note whose bytes are nowhere is counted as `missing` and left alone; one the store refused as
   * `failed`. Throws when `from` is the configured store itself (a probe object put into the target is found in the source), since the
   * move would delete what it moved.
   */
  moveImages(o: { from: ImageStore | "db"; limit: number; after?: string }): Promise<Move>;
  /**
   * The operator's encryption of the notes stored before encryption was turned on (issue #212): at most `limit` plain notes per call,
   * newest first, behind the cursor `after` (as moveImages). Each note is sealed whole and in a safe order (a sealed copy of an image
   * first, the row next, the plain object last); a note that changed meanwhile is passed over (`skipped`) and found again by the
   * next call. Throws when the database is not encrypted.
   */
  reseal(o: { limit: number; after?: string }): Promise<Reseal>;
  /** For the operator's metrics: the database's size on disk, and on PostgreSQL its open connections (null on SQLite). */
  databaseStats(): Promise<{ bytes: number; connections: number | null }>;
};

export type Reseal = { resealed: number; skipped: number; failed: number; left: number; next: string | null };

/** `skipped`: rows that changed meanwhile or were moved by an earlier run. `next`: the cursor for the next call, null when nothing is left. */
export type Move = { moved: { count: number; bytes: number }; skipped: number; missing: number; failed: number; left: number; next: string | null };

// A cursor is "<created_at>:<feed>:<id>" of the last row a call examined (the feed too: two feeds may have a note with the same id
// at the same millisecond); anything else counts as the start. Neither a feed's name nor its fingerprint holds a ":".
type Cursor = { at: number; feed: string; id: string };
function parseCursor(c: string): Cursor | null {
  const m = /^(\d+):([^:]+):(.+)$/.exec(c);
  return m ? { at: Number(m[1]), feed: m[2], id: m[3] } : null;
}
const cursorOf = (r: { created_at: number | string; feed: string; id: string }): Cursor => ({ at: Number(r.created_at), feed: r.feed, id: r.id });
const cursorText = (c: Cursor) => `${c.at}:${c.feed}:${c.id}`;

export type Sweep = { unreferenced: { count: number; bytes: number }; deleted: { count: number; bytes: number }; failed: number; tooRecent: number; missing: number };

/** Where the bytes of the notes with an `external` extension go, instead of the row. Without it, every note's bytes are in its row. */
export type Images = { store: ImageStore; external: (ext: string) => boolean };

const log = logger("storage");
// Thrown inside a transaction to roll it back when a row changed since it was read.
const CHANGED = new Error("changed meanwhile");
const EMPTY = Buffer.alloc(0);
// The markers row the migration to opaque ids writes once a pass of it completed (backend/notemigration.ts).
const NOTE_IDS = "note-ids";

const NAME_RE = /^([A-Za-z0-9_-]{1,128})\.([A-Za-z0-9]{1,16})$/;
const code = (e: unknown) => String((e as { code?: unknown })?.code ?? "");
const isForeignKey = (e: unknown) => code(e) === "23503" || code(e) === "SQLITE_CONSTRAINT_FOREIGNKEY";
const isUnique = (e: unknown) => code(e) === "23505" || code(e) === "SQLITE_CONSTRAINT_UNIQUE" || code(e) === "SQLITE_CONSTRAINT_PRIMARYKEY";
const changed = (n: bigint | number | undefined) => Number(n ?? 0) > 0;
const bytes = (content: string | Uint8Array) => (typeof content === "string" ? Buffer.from(content) : Buffer.from(content));

// A name or a read id of a removed feed may not come back (issue #155). Both come as they are stored: fingerprints when encrypted.
async function refuseRemoved(db: Kysely<Schema>, feed: string | undefined, readId: string): Promise<void> {
  if (feed !== undefined && (await db.selectFrom("tombstones").select("name").where("name", "=", feed).executeTakeFirst())) throw new RemovedFeedError();
  if (await db.selectFrom("tombstones").select("name").where("read_id", "=", readId).executeTakeFirst()) throw new ReadIdTakenError();
}

// The parts of a feed's row that say how its values are stored.
type FeedKeys = { name: string; data_key: string | null; key_id: string | null };

// `kind` picks the dialect-specific migration; `connect` is called once, on first use. With a `wrapper` (the main key) the database
// is encrypted (issue #212): names and read ids are stored as fingerprints, a feed's values sealed with its own data key.
export function createSqlStorage(connect: () => Promise<Kysely<Schema>>, kind: Kind = "sqlite", images?: Images, wrapper: KeyWrapper | null = null): SqlStorage {
  let connecting: Promise<Kysely<Schema>> | undefined;
  let opened: Promise<Kysely<Schema>> | undefined;
  let ring: Keyring | null = null; // set by open(), before any query
  // What a name or a read id is stored as, and looked up by.
  const ident = (k: FingerprintKind, v: string) => (ring ? ring.fingerprint(k, v) : v);
  // A feed's data key; null for a plain feed. A row with a key_id is only read with a keyring (the keyring refuses to open otherwise).
  const keyOf = async (row: FeedKeys): Promise<Buffer | null> => (row.key_id === null ? null : ring!.feedKey(row));
  const sealIn = (key: Buffer | null, v: string, aad: string) => (key ? sealText(key, v, aad) : v);
  const openIn = (key: Buffer | null, v: string, aad: string) => (key ? openText(key, v, aad) : v);
  // A feed's values are bound to its fingerprint (`name`): moved onto another feed's row, they do not open.
  const fa = (name: string, what: string) => `feed:${name}:${what}`;
  const nameOf = async (row: FeedKeys & { name_sealed: string | null }) => openIn(await keyOf(row), row.key_id === null ? row.name : row.name_sealed!, fa(row.name, "name"));
  // A sealed note's key is its feed's. A sealed note on a feed without a key is refused, never read as plain.
  const sealedKey = async (sealed: number, feedRow: FeedKeys): Promise<Buffer | null> => {
    if (!sealed) return null;
    if (feedRow.key_id === null) throw new CipherError("a sealed note's feed has no data key");
    return keyOf(feedRow);
  };
  // undefined when the feed is gone meanwhile.
  const noteKey = async (db: Kysely<Schema>, feed: string, sealed: number): Promise<Buffer | null | undefined> => {
    if (!sealed) return null;
    const row = await feedKeys(db, feed);
    return row ? sealedKey(sealed, row) : undefined;
  };
  // A note's row with its feed's keys, in one query.
  const withFeed = (db: Kysely<Schema>, feed: string) => db.selectFrom("notes").innerJoin("feeds", "feeds.name", "notes.feed").where("notes.feed", "=", ident("feed", feed));
  // The bytes and the metadata are bound to the note's file name (id and extension), not to where the bytes are: moveImages copies
  // them as they are.
  const na = (id: string, ext: string, what: string) => `note:${id}.${ext}:${what}`;
  const contentIn = (key: Buffer | null, id: string, ext: string, b: Buffer) => (key ? openBytes(key, b, na(id, ext, "content")) : b);
  const metaIn = (key: Buffer | null, id: string, ext: string, raw: string | null): Meta => (raw ? parseMeta(openIn(key, raw, na(id, ext, "meta"))) : {});
  const metaOut = (key: Buffer | null, id: string, ext: string, meta: Meta): string | null => (hasMeta(meta) ? sealIn(key, JSON.stringify(meta), na(id, ext, "meta")) : null);
  const feedKeys = async (db: Kysely<Schema>, feed: string) => db.selectFrom("feeds").select(["name", "data_key", "key_id"]).where("name", "=", ident("feed", feed)).executeTakeFirst();

  // After the row is gone (or never came to be), its object is only storage: a failure to remove it is logged, never the caller's error.
  // No feed or key in the line: a feed's name is its secret.
  const drop = async (keys: (string | null | undefined)[]) => {
    for (const key of keys) {
      if (!key || !images) continue;
      await images.store.delete(key).then(
        () => log.info("image deleted from the image store"),
        (err) => log.warn({ err }, "could not remove an image from the image store; it stays there unreferenced"),
      );
    }
  };
  // Never the key in the line: only that an object went in, and its size.
  const stored = async (key: string, data: Buffer) => {
    await images!.store.put(key, data);
    log.info({ bytes: data.byteLength }, "image stored in the image store");
  };
  // The bytes of a row: its own, or the object its key names. null when the object is gone.
  const bytesOf = async (row: { content: Buffer | Uint8Array; blob_key: string | null }): Promise<Buffer | null> => {
    if (row.blob_key === null) return Buffer.from(row.content);
    if (!images) {
      log.error("a note's image is in an image store, but NOTEFEED_IMAGES names none");
      return null;
    }
    const found = await images.store.get(row.blob_key);
    if (!found) log.error("a note's image is missing from the image store");
    return found;
  };

  // The errors a caller sees as they are; any other is replaced, as the driver's names the address or the file (no `cause`: the log
  // would carry it).
  const known = (e: unknown) => {
    const ok = e instanceof KeyringError || keyServiceDown(e) || (e instanceof Error && e.message.startsWith("the database was made by a newer notefeed"));
    return ok ? e : new Error(`cannot use the database named by NOTEFEED_DATABASE_URL (${code(e) || (e as Error)?.name || "error"})`);
  };

  // The database, migrated, without its keys: enough for what is stored in plain columns (migrationPending, with the key service down).
  function connected(): Promise<Kysely<Schema>> {
    if (connecting) return connecting;
    const attempt = (async () => {
      let db: Kysely<Schema> | undefined;
      try {
        db = await connect();
        await migrate(db, kind);
        return db;
      } catch (e) {
        await db?.destroy().catch(() => {});
        throw known(e);
      }
    })();
    connecting = attempt;
    attempt.catch(() => connecting === attempt && (connecting = undefined)); // retry after a failure
    return attempt;
  }

  function open(): Promise<Kysely<Schema>> {
    if (opened) return opened;
    const attempt = (async () => {
      const db = await connected();
      try {
        ring = await openKeyring(db, kind, wrapper);
        return db;
      } catch (e) {
        throw known(e);
      }
    })();
    opened = attempt;
    attempt.catch(() => opened === attempt && (opened = undefined)); // retry after a failure
    return attempt;
  }

  // The extensions whose bytes belong in the image store, for the move's "rows still holding their bytes" query.
  const EXTERNAL_EXTS = () => (IMAGE_EXTS as readonly string[]).filter((e) => images?.external(e));

  return {
    // With an image store, the object is written first and the row second: a row never names bytes that are not there. If the row
    // does not come to be, the object is removed again.
    // Encrypted, the bytes are sealed for the id the note gets; should that id be taken, they are sealed (and stored) again for the next.
    async writeNote(feed, base, ext, content, meta, date, draft = false) {
      const db = await open();
      const f = ident("feed", feed);
      // Plain, the insert itself finds out that the feed is gone (a foreign key); encrypted, its key is needed first.
      const feedRow = ring ? await feedKeys(db, feed) : null;
      if (ring && !feedRow) throw new FeedGoneError();
      const fkey = feedRow ? await keyOf(feedRow) : null;
      const now = Date.now();
      const data = bytes(content);
      const key = images?.external(ext) ? newKey() : null;
      try {
        for (let n = 1; ; n++) {
          const id = n === 1 ? base : `${base}-${n}`;
          const out = fkey ? seal(fkey, data, na(id, ext, "content")) : data;
          if (key && (n === 1 || fkey)) await stored(key, out);
          const r = await db
            .insertInto("notes")
            .values({ feed: f, id, ext, content: key ? EMPTY : out, blob_key: key, size: data.byteLength, metadata: metaOut(fkey, id, ext, meta), created_at: now, updated_at: now, date, sealed: fkey ? 1 : 0, draft: draft ? 1 : 0 })
            .onConflict((oc) => oc.columns(["feed", "id"]).doNothing())
            .executeTakeFirst();
          if (changed(r.numInsertedOrUpdatedRows)) return id;
        }
      } catch (e) {
        await drop([key]);
        if (isForeignKey(e)) throw new FeedGoneError();
        throw e;
      }
    },

    // `before` is looked up first, within `upTo` and `drafts`, for its (date, id); the page is then the rows after it in the order
    // (notes_by_draft_date).
    async listNoteRefs(feed, { upTo, before, limit, drafts } = {}) {
      let q = (await open()).selectFrom("notes").select(["id", "ext", "date", "draft"]).where("feed", "=", ident("feed", feed));
      if (drafts !== true) q = q.where("draft", "=", 0);
      if (upTo !== undefined) q = q.where("date", "<=", upTo);
      if (before !== undefined) {
        const at = await q.where("id", "=", before).executeTakeFirst();
        if (!at) return [];
        const date = Number(at.date);
        q = q.where((eb) => eb.or([eb("date", "<", date), eb.and([eb("date", "=", date), eb("id", "<", before)])]));
      }
      if (limit !== undefined) q = q.limit(limit);
      const rows = await q.orderBy("date", "desc").orderBy("id", "desc").execute();
      if (upTo === undefined && before === undefined && limit === undefined && drafts === true) noteFeedSize(rows.length); // only a whole listing is the feed's size
      return rows.map((r) => ({ id: r.id, ext: r.ext, date: Number(r.date), draft: Number(r.draft) === 1 }));
    },

    async readNote(feed, id, exts, withContent) {
      if (exts.length === 0) return null;
      const db = await open();
      const row = await withFeed(db, feed)
        .select(["notes.ext", "notes.metadata", "notes.updated_at", "notes.date", "notes.draft", "notes.size", "notes.sealed", "feeds.name", "feeds.data_key", "feeds.key_id"])
        .where("notes.id", "=", id)
        .where("notes.ext", "in", exts)
        .executeTakeFirst();
      if (!row) return null;
      const key = await sealedKey(row.sealed, row);
      let content: Buffer = EMPTY;
      if (withContent(row.ext)) {
        // `sealed` again with the bytes: reseal may have sealed the note since the first read.
        const full = await db.selectFrom("notes").select(["content", "blob_key", "sealed"]).where("feed", "=", ident("feed", feed)).where("id", "=", id).executeTakeFirst();
        const found = full && (await bytesOf(full));
        if (!found) return null; // deleted since the first read, or its object is gone
        const bytesKey = full.sealed === row.sealed ? key : await noteKey(db, feed, full.sealed);
        if (bytesKey === undefined) return null;
        content = contentIn(bytesKey, id, row.ext, found);
      }
      return { ext: row.ext, content, size: Number(row.size), meta: metaIn(key, id, row.ext, row.metadata), mtime: new Date(Number(row.updated_at)), date: Number(row.date), draft: Number(row.draft) === 1 };
    },

    async readMeta(feed, ref) {
      const db = await open();
      const row = await withFeed(db, feed).select(["notes.metadata", "notes.sealed", "feeds.name", "feeds.data_key", "feeds.key_id"]).where("notes.id", "=", ref.id).where("notes.ext", "=", ref.ext).executeTakeFirst();
      if (!row) return null;
      return metaIn(await sealedKey(row.sealed, row), ref.id, ref.ext, row.metadata);
    },

    // A note that belongs in the image store gets a new object, then the row is pointed at it, then the old object goes: a reader
    // meets the old bytes or the new ones, never a key without an object. The update names the key it replaces, so of two
    // replacements at once each removes the object it took out of the row, and none is removed twice or left behind.
    async replaceNote(feed, id, exts, content) {
      if (exts.length === 0) return false;
      const db = await open();
      const data = bytes(content);
      let key: string | null = null;
      try {
        for (;;) {
          const row = await db.selectFrom("notes").select(["ext", "blob_key", "sealed"]).where("feed", "=", ident("feed", feed)).where("id", "=", id).where("ext", "in", exts).executeTakeFirst();
          if (!row) break;
          // The note stays as it is stored, sealed or plain: only reseal turns a plain note into a sealed one.
          const nkey = await noteKey(db, feed, row.sealed);
          if (nkey === undefined) break;
          const out = nkey ? seal(nkey, data, na(id, row.ext, "content")) : data;
          if (!key && images?.external(row.ext)) await stored((key = newKey()), out);
          else if (key && nkey) await stored(key, out);
          const r = await db
            .updateTable("notes")
            .set({ content: key ? EMPTY : out, blob_key: key, size: data.byteLength, updated_at: Date.now() })
            .where("feed", "=", ident("feed", feed))
            .where("id", "=", id)
            .where("ext", "=", row.ext)
            .where("blob_key", row.blob_key === null ? "is" : "=", row.blob_key)
            .where("sealed", "=", row.sealed)
            .executeTakeFirst();
          if (!changed(r.numUpdatedRows)) continue; // replaced or deleted meanwhile: look again
          await drop([row.blob_key]);
          return true;
        }
      } catch (e) {
        await drop([key]);
        throw e;
      }
      await drop([key]);
      return false;
    },

    async updateMeta(feed, id, exts, patch) {
      if (exts.length === 0) return false;
      // The update names the metadata and the state it read, so a reseal in between (on PostgreSQL, from another connection) makes it
      // read again rather than write plain metadata onto a sealed note.
      return (await open()).transaction().execute(async (tx) => {
        for (;;) {
          const row = await tx.selectFrom("notes").select(["ext", "metadata", "sealed"]).where("feed", "=", ident("feed", feed)).where("id", "=", id).where("ext", "in", exts).executeTakeFirst();
          if (!row) return false;
          const key = await noteKey(tx, feed, row.sealed);
          if (key === undefined) return false;
          const merged = applyPatch(metaIn(key, id, row.ext, row.metadata), patch);
          const r = await tx
            .updateTable("notes")
            .set({ metadata: metaOut(key, id, row.ext, merged) })
            .where("feed", "=", ident("feed", feed))
            .where("id", "=", id)
            .where("sealed", "=", row.sealed)
            .where("metadata", row.metadata === null ? "is" : "=", row.metadata)
            .executeTakeFirst();
          if (changed(r.numUpdatedRows)) return true;
        }
      });
    },

    async setDate(feed, id, exts, date) {
      if (exts.length === 0) return false;
      const r = await (await open()).updateTable("notes").set({ date }).where("feed", "=", ident("feed", feed)).where("id", "=", id).where("ext", "in", exts).executeTakeFirst();
      return changed(r.numUpdatedRows);
    },

    async setDraft(feed, id, exts, draft) {
      if (exts.length === 0) return false;
      const r = await (await open()).updateTable("notes").set({ draft: draft ? 1 : 0 }).where("feed", "=", ident("feed", feed)).where("id", "=", id).where("ext", "in", exts).executeTakeFirst();
      return changed(r.numUpdatedRows);
    },

    // The content and the metadata are bound to the note's name: opened under the old one, sealed under the new. A sealed image gets a
    // copy sealed for the new name under a new key first (a plain one keeps its key: its bytes are not bound to a name); then, in one
    // transaction, the new row goes in and the old one out; the old object goes last, as in replaceNote. The delete names the state it
    // read, so a note changed meanwhile is read again; a taken id rolls the insert back.
    async renameNote(feed, id, ext, newId) {
      const db = await open();
      const f = ident("feed", feed);
      let copy: string | null = null;
      try {
        for (;;) {
          const row = await withFeed(db, feed)
            .selectAll("notes")
            .select(["feeds.name", "feeds.data_key", "feeds.key_id"])
            .where("notes.id", "=", id)
            .where("notes.ext", "=", ext)
            .executeTakeFirst();
          if (!row) return false;
          const key = await sealedKey(row.sealed, row);
          let content = row.content;
          let blobKey = row.blob_key;
          if (key) {
            const found = await bytesOf(row);
            if (!found) return false; // its object is gone
            const out = seal(key, contentIn(key, id, ext, found), na(newId, ext, "content"));
            if (row.blob_key === null) content = out;
            else await stored((blobKey = copy = newKey()), out);
          }
          const metadata = row.metadata === null ? null : sealIn(key, openIn(key, row.metadata, na(id, ext, "meta")), na(newId, ext, "meta"));
          const done = await db
            .transaction()
            .execute(async (tx) => {
              const r = await tx
                .insertInto("notes")
                .values({ feed: f, id: newId, ext, content, blob_key: blobKey, size: Number(row.size), metadata, created_at: Number(row.created_at), updated_at: Number(row.updated_at), date: Number(row.date), sealed: row.sealed, draft: row.draft })
                .onConflict((oc) => oc.columns(["feed", "id"]).doNothing())
                .executeTakeFirst();
              if (!changed(r.numInsertedOrUpdatedRows)) return false;
              const d = await tx
                .deleteFrom("notes")
                .where("feed", "=", f)
                .where("id", "=", id)
                .where("ext", "=", ext)
                .where("sealed", "=", row.sealed)
                .where("blob_key", row.blob_key === null ? "is" : "=", row.blob_key)
                .where("metadata", row.metadata === null ? "is" : "=", row.metadata)
                .where("updated_at", "=", Number(row.updated_at))
                .where("date", "=", Number(row.date))
                .$if(row.blob_key === null, (q) => q.where("content", "=", row.content))
                .executeTakeFirst();
              if (!changed(d.numDeletedRows)) throw CHANGED; // rolls the insert back
              return true;
            })
            .catch((e) => (e === CHANGED ? null : Promise.reject(e)));
          if (done === null) {
            await drop([copy]);
            copy = null;
            continue; // changed or deleted meanwhile: look again
          }
          if (!done) {
            await drop([copy]);
            return false;
          }
          if (copy) await drop([row.blob_key]);
          return true;
        }
      } catch (e) {
        await drop([copy]);
        throw e;
      }
    },

    async deleteNote(feed, id, exts) {
      if (exts.length === 0) return false;
      const rows = await (await open()).deleteFrom("notes").where("feed", "=", ident("feed", feed)).where("id", "=", id).where("ext", "in", exts).returning("blob_key").execute();
      await drop(rows.map((r) => r.blob_key)); // the row first: a crash in between leaves an object, never a note without its image
      return rows.length > 0;
    },

    async readFile(feed, name) {
      const m = NAME_RE.exec(name);
      if (!m) return null;
      const db = await open();
      const row = await withFeed(db, feed).select(["notes.content", "notes.blob_key", "notes.sealed", "feeds.name", "feeds.data_key", "feeds.key_id"]).where("notes.id", "=", m[1]).where("notes.ext", "=", m[2]).executeTakeFirst();
      if (!row) return null;
      const key = await sealedKey(row.sealed, row);
      const found = await bytesOf(row);
      return found && contentIn(key, m[1], m[2], found);
    },

    async readSettings(feed) {
      const row = await (await open()).selectFrom("feeds").select(["name", "settings", "data_key", "key_id"]).where("name", "=", ident("feed", feed)).executeTakeFirst();
      if (!row?.settings) return parseSettings(null);
      return parseSettings(openIn(await keyOf(row), row.settings, fa(row.name, "settings")));
    },
    async writeSettings(feed, s) {
      const db = await open();
      const row = await feedKeys(db, feed);
      if (!row) throw new FeedGoneError();
      const r = await db.updateTable("feeds").set({ settings: sealIn(await keyOf(row), serializeSettings(s), fa(row.name, "settings")) }).where("name", "=", ident("feed", feed)).where("data_key", row.data_key === null ? "is" : "=", row.data_key).executeTakeFirst();
      if (!changed(r.numUpdatedRows)) throw new FeedGoneError();
    },
    async readHash(feed) {
      const row = await (await open()).selectFrom("feeds").select(["name", "password_hash", "data_key", "key_id"]).where("name", "=", ident("feed", feed)).executeTakeFirst();
      if (!row?.password_hash) return null;
      return openIn(await keyOf(row), row.password_hash, fa(row.name, "hash"));
    },
    async writeHash(feed, hash) {
      const db = await open();
      const row = await feedKeys(db, feed);
      if (!row) throw new FeedGoneError();
      const r = await db.updateTable("feeds").set({ password_hash: sealIn(await keyOf(row), hash, fa(row.name, "hash")) }).where("name", "=", ident("feed", feed)).where("data_key", row.data_key === null ? "is" : "=", row.data_key).executeTakeFirst();
      if (!changed(r.numUpdatedRows)) throw new FeedGoneError();
    },
    async removeHash(feed) {
      await (await open()).updateTable("feeds").set({ password_hash: null }).where("name", "=", ident("feed", feed)).execute();
    },

    async createFeed(feed, readId, hash) {
      const db = await open();
      await refuseRemoved(db, ident("feed", feed), ident("read_id", readId));
      // Encrypted: a new data key for the feed, the name and read id sealed with it next to their fingerprints.
      const name = ident("feed", feed);
      const k = ring ? await ring.newFeedKey(name) : null;
      try {
        const r = await db
          .insertInto("feeds")
          .values({
            name,
            read_id: ident("read_id", readId),
            password_hash: hash === undefined ? null : sealIn(k?.key ?? null, hash, fa(name, "hash")),
            settings: null,
            created_at: Date.now(),
            key_id: k?.key_id ?? null,
            data_key: k?.data_key ?? null,
            name_sealed: k ? sealText(k.key, feed, fa(name, "name")) : null,
            read_id_sealed: k ? sealText(k.key, readId, fa(name, "read_id")) : null,
          })
          .onConflict((oc) => oc.column("name").doNothing())
          .executeTakeFirst();
        return { created: changed(r.numInsertedOrUpdatedRows) };
      } catch (e) {
        if (isUnique(e)) throw new ReadIdTakenError(); // the name conflict is handled above, so this is the read id
        throw e;
      }
    },
    async deleteFeed(feed) {
      const db = await open();
      // The keys are read before the rows go with the feed (cascade). An image posted in between leaves its object unreferenced.
      const keys = await db.selectFrom("notes").select("blob_key").where("feed", "=", ident("feed", feed)).where("blob_key", "is not", null).execute();
      const r = await db.deleteFrom("feeds").where("name", "=", ident("feed", feed)).executeTakeFirst();
      if (!changed(r.numDeletedRows)) return false;
      await drop(keys.map((k) => k.blob_key));
      return true;
    },
    async forgetFeed() {
      // Nothing to drop: the rows are the truth, and a feed that is there is not "gone".
    },
    async setReadId(feed, readId) {
      const db = await open();
      await refuseRemoved(db, undefined, ident("read_id", readId));
      const row = await feedKeys(db, feed);
      if (!row) throw new NotFoundError("no such feed");
      const key = await keyOf(row);
      try {
        const r = await db
          .updateTable("feeds")
          .set({ read_id: ident("read_id", readId), read_id_sealed: key ? sealText(key, readId, fa(row.name, "read_id")) : null })
          .where("name", "=", ident("feed", feed))
          .where("data_key", row.data_key === null ? "is" : "=", row.data_key)
          .executeTakeFirst();
        if (!changed(r.numUpdatedRows)) throw new NotFoundError("no such feed");
      } catch (e) {
        if (isUnique(e)) throw new ReadIdTakenError();
        throw e;
      }
    },
    async feedReadId(feed) {
      const row = await (await open()).selectFrom("feeds").select(["name", "read_id", "read_id_sealed", "data_key", "key_id"]).where("name", "=", ident("feed", feed)).executeTakeFirst();
      if (!row) return undefined;
      return row.key_id === null ? row.read_id : openIn(await keyOf(row), row.read_id_sealed!, fa(row.name, "read_id"));
    },
    async feedForReadId(readId) {
      const row = await (await open()).selectFrom("feeds").select(["name", "name_sealed", "data_key", "key_id"]).where("read_id", "=", ident("read_id", readId)).executeTakeFirst();
      return row ? nameOf(row) : null;
    },
    // Sorted here, not in SQL: encrypted, the column holds fingerprints.
    async listFeeds() {
      const rows = await (await open()).selectFrom("feeds").select(["name", "name_sealed", "data_key", "key_id"]).execute();
      const names = await Promise.all(rows.map(nameOf));
      return names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    },
    async listFeedNames() {
      return this.listFeeds();
    },
    // Plain rows and columns, so no key is needed.
    async migrationPending() {
      const db = await connected();
      if (await db.selectFrom("markers").select("name").where("name", "=", NOTE_IDS).executeTakeFirst()) return false;
      return !!(await db.selectFrom("notes").select("id").limit(1).executeTakeFirst());
    },
    async markMigrated() {
      await (await connected()).insertInto("markers").values({ name: NOTE_IDS, at: Date.now() }).onConflict((c) => c.column("name").doNothing()).execute();
    },
    async feedCount() {
      const r = await (await open()).selectFrom("feeds").select(sql<number | string>`count(*)`.as("n")).executeTakeFirstOrThrow();
      return Number(r.n);
    },
    // Two grouped queries, joined here by the `name` column (a fingerprint when encrypted): no name is opened, no data key used.
    // Every feed row holds a read id: on a database a feed always has its read link.
    async usage() {
      const db = await open();
      const feeds = await db.selectFrom("feeds").select(["name", "password_hash"]).execute();
      const notes = await db
        .selectFrom("notes")
        .select(["feed", "ext", sql<number | string>`count(*)`.as("n"), sql<number | string>`coalesce(sum(size), 0)`.as("bytes"), sql<number | string>`max(updated_at)`.as("last")])
        .groupBy(["feed", "ext"])
        .execute();
      const byFeed = new Map<string, FeedUsage>(feeds.map((f) => [f.name, { protected: f.password_hash !== null, readLink: true, lastWrite: null, notes: {} }]));
      for (const r of notes) {
        const u = byFeed.get(r.feed);
        if (!u) continue;
        u.notes[r.ext] = { count: Number(r.n), bytes: Number(r.bytes) };
        u.lastWrite = Math.max(u.lastWrite ?? 0, Number(r.last));
      }
      return [...byFeed.values()];
    },

    // The tombstone goes in first, in its own statement, so a crash after it leaves a feed that is found by neither identifier
    // and removed by the next run; the rows go with the feed (cascade), the objects last, as in deleteFeed. Encrypted, the
    // tombstone holds the fingerprints only: nothing needs the name back.
    async takedownFeed(feed, readId) {
      const db = await open();
      const f = ident("feed", feed);
      const id = readId !== null ? ident("read_id", readId) : ((await db.selectFrom("feeds").select("read_id").where("name", "=", f).executeTakeFirst())?.read_id ?? null);
      await db.insertInto("tombstones").values({ name: f, read_id: id, removed_at: Date.now(), sealed: ring ? 1 : 0 }).onConflict((oc) => oc.column("name").doNothing()).execute();
      const keys = (await db.selectFrom("notes").select("blob_key").where("feed", "=", f).where("blob_key", "is not", null).execute()).map((k) => k.blob_key!);
      const r = await db.deleteFrom("feeds").where("name", "=", f).executeTakeFirst();
      if (!changed(r.numDeletedRows)) return { removed: false, keys: [] };
      await drop(keys);
      return { removed: true, keys };
    },
    async isRemoved({ feed, readId }) {
      const db = await open();
      if (feed !== undefined && (await db.selectFrom("tombstones").select("name").where("name", "=", ident("feed", feed)).executeTakeFirst())) return true;
      if (readId !== undefined && (await db.selectFrom("tombstones").select("name").where("read_id", "=", ident("read_id", readId)).executeTakeFirst())) return true;
      return false;
    },
    // The tombstones first, so from here on the notes are not served (the callers ask isRemovedNote); then the rows, then their
    // objects, as deleteNote; then the mark, through writeNote like any note. A crash in between leaves notes nobody is served,
    // which the operator's next takedown of the same post removes.
    async takedownNotes(feed, notes, mark) {
      const db = await open();
      const f = ident("feed", feed);
      const ids = notes.map((n) => n.id);
      let keys: string[] = [];
      if (ids.length > 0) {
        try {
          await db.insertInto("note_tombstones").values(ids.map((id) => ({ feed: f, id, removed_at: Date.now() }))).onConflict((oc) => oc.columns(["feed", "id"]).doNothing()).execute();
        } catch (e) {
          if (isForeignKey(e)) throw new FeedGoneError();
          throw e;
        }
        const rows = await db.deleteFrom("notes").where("feed", "=", f).where("id", "in", ids).returning("blob_key").execute();
        keys = rows.flatMap((r) => (r.blob_key ? [r.blob_key] : []));
        await drop(keys);
      }
      if (mark) await this.writeNote(feed, mark.id, "removed", EMPTY, {}, mark.date, mark.draft);
      return { keys };
    },
    async isRemovedNote(feed, id) {
      return !!(await (await open()).selectFrom("note_tombstones").select("id").where("feed", "=", ident("feed", feed)).where("id", "=", id).executeTakeFirst());
    },
    async blockImages(hashes) {
      if (hashes.length === 0) return;
      const now = Date.now();
      await (await open()).insertInto("blocked_images").values(hashes.map((hash) => ({ hash, added_at: now }))).onConflict((oc) => oc.column("hash").doNothing()).execute();
    },
    async isBlockedImage(hash) {
      return !!(await (await open()).selectFrom("blocked_images").select("hash").where("hash", "=", hash).executeTakeFirst());
    },

    async databaseStats() {
      const db = await open();
      if (kind === "postgres") {
        const size = await sql<{ n: string }>`select pg_database_size(current_database()) as n`.execute(db);
        const conns = await sql<{ n: string }>`select count(*) as n from pg_stat_activity where datname = current_database()`.execute(db);
        return { bytes: Number(size.rows[0].n), connections: Number(conns.rows[0].n) };
      }
      const pages = await sql<{ n: number }>`select page_count * page_size as n from pragma_page_count(), pragma_page_size()`.execute(db);
      return { bytes: Number(pages.rows[0].n), connections: null };
    },

    // The store is listed first and the rows are read after it. An object old enough to count was written before its row, so a row
    // that names it is there by the time the rows are read; a note posted meanwhile has a young object, which is passed over.
    async sweepImages({ remove, olderThanMs }) {
      if (!images) return null;
      const db = await open();
      const started = Date.now();
      const old = new Map<string, number>();
      const inStore = new Set<string>();
      let tooRecent = 0;
      for await (const o of images.store.list()) {
        inStore.add(o.key);
        if (o.modified.getTime() <= started - olderThanMs) old.set(o.key, o.size);
        else tooRecent++;
      }
      const rows = await db.selectFrom("notes").select(["blob_key", "updated_at"]).where("blob_key", "is not", null).execute();
      let missing = 0;
      for (const row of rows) {
        old.delete(row.blob_key!);
        // A row written since the listing began names an object the listing may not have seen.
        if (!inStore.has(row.blob_key!) && Number(row.updated_at) < started) missing++;
      }
      const sweep: Sweep = { unreferenced: { count: old.size, bytes: [...old.values()].reduce((a, b) => a + b, 0) }, deleted: { count: 0, bytes: 0 }, failed: 0, tooRecent, missing };
      if (!remove) return sweep;
      for (const [key, size] of old) {
        try {
          await images.store.delete(key);
          sweep.deleted.count++;
          sweep.deleted.bytes += size;
        } catch (err) {
          sweep.failed++;
          log.warn({ err }, "could not remove an unreferenced image from the image store");
        }
      }
      log.info({ deleted: sweep.deleted.count, bytes: sweep.deleted.bytes, failed: sweep.failed }, "unreferenced images removed from the image store");
      return sweep;
    },

    // Nothing here changes a note's id, ext or metadata: the move is about where the bytes are, and a reader meets the old place or
    // the new one. Rows are walked newest first behind a cursor (`after`, the last row the previous call examined), so a call that
    // finds a row changed meanwhile (replaced, deleted, already moved) passes it over and the next call goes on behind it.
    async moveImages({ from, limit, after }) {
      const db = await open();
      const target = images?.store ?? null;
      if (from === "db" && !target) throw new Error("nothing to move: the images are in the database and NOTEFEED_IMAGES is db");
      if (from !== "db" && target) {
        // The same store under two names would delete what it moved: a probe written to the target must not show up in the source.
        const probe = newKey();
        await target.put(probe, Buffer.from("probe"));
        try {
          if (await from.get(probe)) throw new Error("nothing to move: the source is the configured store itself");
        } finally {
          await target.delete(probe).catch(() => {});
        }
      }
      const move: Move = { moved: { count: 0, bytes: 0 }, skipped: 0, missing: 0, failed: 0, left: 0, next: null };
      const cursor = after ? parseCursor(after) : null;
      const pending = (before: Cursor | null) => {
        let q = from === "db" ? db.selectFrom("notes").where("blob_key", "is", null).where("ext", "in", EXTERNAL_EXTS()) : db.selectFrom("notes").where("blob_key", "is not", null);
        if (before)
          q = q.where((eb) =>
            eb.or([
              eb("created_at", "<", before.at),
              eb.and([eb("created_at", "=", before.at), eb("feed", "<", before.feed)]),
              eb.and([eb("created_at", "=", before.at), eb("feed", "=", before.feed), eb("id", "<", before.id)]),
            ]),
          );
        return q;
      };
      const rows = await pending(cursor).select(["feed", "id", "blob_key", "content", "created_at"]).orderBy("created_at", "desc").orderBy("feed", "desc").orderBy("id", "desc").limit(limit).execute();
      for (const row of rows) {
        try {
          if (from === "db") {
            // Row to store: the object first, the row next; a row that is gone or already moved leaves the object to be removed again.
            const key = newKey();
            const data = Buffer.from(row.content);
            await stored(key, data);
            const r = await db.updateTable("notes").set({ content: EMPTY, blob_key: key }).where("feed", "=", row.feed).where("id", "=", row.id).where("blob_key", "is", null).executeTakeFirst();
            if (!changed(r.numUpdatedRows)) {
              await drop([key]);
              move.skipped++;
              continue;
            }
            move.moved.count++;
            move.moved.bytes += data.byteLength;
          } else {
            const key = row.blob_key!;
            const data = await from.get(key);
            if (!data) {
              // Store to store leaves the row as it is, so a row whose object is already in the target was moved by an earlier run.
              if (target && (await target.get(key))) move.skipped++;
              else move.missing++;
              continue;
            }
            if (target) {
              // Store to store, under the same key: the row needs no change, and a run stopped after the copy only copies again.
              await stored(key, data);
            } else {
              // Store to row: the bytes into the row, then the object goes.
              const r = await db.updateTable("notes").set({ content: data, blob_key: null }).where("feed", "=", row.feed).where("id", "=", row.id).where("blob_key", "=", key).executeTakeFirst();
              if (!changed(r.numUpdatedRows)) {
                move.skipped++;
                continue;
              }
            }
            await from.delete(key);
            move.moved.count++;
            move.moved.bytes += data.byteLength;
          }
        } catch (err) {
          move.failed++;
          log.warn({ err }, "an image could not be moved");
        }
      }
      if (rows.length === limit) {
        const last = rows[rows.length - 1];
        const at = cursorOf(last);
        const r = await pending(at).select(sql<number | string>`count(*)`.as("n")).executeTakeFirstOrThrow();
        move.left = Number(r.n);
        move.next = move.left > 0 ? `${cursorText(at)}` : null;
      }
      log.info({ moved: move.moved.count, bytes: move.moved.bytes, skipped: move.skipped, missing: move.missing, failed: move.failed, left: move.left }, "images moved to the configured store");
      return move;
    },

    async reseal({ limit, after }) {
      const db = await open();
      if (!ring) throw new Error("nothing to reseal: NOTEFEED_ENCRYPTION_KEY is not set");
      const out: Reseal = { resealed: 0, skipped: 0, failed: 0, left: 0, next: null };
      const pending = (before: Cursor | null) => {
        let q = db.selectFrom("notes").where("sealed", "=", 0);
        if (before)
          q = q.where((eb) =>
            eb.or([
              eb("created_at", "<", before.at),
              eb.and([eb("created_at", "=", before.at), eb("feed", "<", before.feed)]),
              eb.and([eb("created_at", "=", before.at), eb("feed", "=", before.feed), eb("id", "<", before.id)]),
            ]),
          );
        return q;
      };
      const rows = await pending(after ? parseCursor(after) : null)
        .select(["feed", "id", "ext", "content", "blob_key", "metadata", "created_at", "updated_at"])
        .orderBy("created_at", "desc")
        .orderBy("feed", "desc")
        .orderBy("id", "desc")
        .limit(limit)
        .execute();
      for (const row of rows) {
        let copy: string | null = null;
        try {
          // Since the start, every feed has its data key; notes are on the feed's fingerprint.
          const feedRow = await db.selectFrom("feeds").select(["name", "data_key", "key_id"]).where("name", "=", row.feed).executeTakeFirst();
          const key = feedRow && (await keyOf(feedRow));
          const plain = key && (await bytesOf(row));
          if (!key || !plain) {
            out.skipped++; // the feed went meanwhile, or the image is missing from the store (sweepImages counts those)
            continue;
          }
          const sealedBytes = seal(key, plain, na(row.id, row.ext, "content"));
          if (row.blob_key !== null) await stored((copy = newKey()), sealedBytes);
          const r = await db
            .updateTable("notes")
            .set({ content: copy ? EMPTY : sealedBytes, blob_key: copy, metadata: row.metadata === null ? null : sealText(key, row.metadata, na(row.id, row.ext, "meta")), sealed: 1 })
            .where("feed", "=", row.feed)
            .where("id", "=", row.id)
            .where("sealed", "=", 0)
            .where("blob_key", row.blob_key === null ? "is" : "=", row.blob_key)
            .where("metadata", row.metadata === null ? "is" : "=", row.metadata)
            .where("updated_at", "=", Number(row.updated_at))
            // In its row, the bytes themselves: a replace within the same millisecond leaves updated_at as it was.
            .$if(row.blob_key === null, (q) => q.where("content", "=", row.content))
            .executeTakeFirst();
          if (!changed(r.numUpdatedRows)) {
            await drop([copy]);
            out.skipped++;
            continue;
          }
          await drop([row.blob_key]);
          out.resealed++;
        } catch (err) {
          await drop([copy]);
          out.failed++;
          log.warn({ err }, "a note could not be resealed");
        }
      }
      if (rows.length === limit) {
        const last = rows[rows.length - 1];
        const at = cursorOf(last);
        const r = await pending(at).select(sql<number | string>`count(*)`.as("n")).executeTakeFirstOrThrow();
        out.left = Number(r.n);
        out.next = out.left > 0 ? `${cursorText(at)}` : null;
      }
      log.info({ resealed: out.resealed, skipped: out.skipped, failed: out.failed, left: out.left }, "notes resealed");
      return out;
    },

    async close() {
      if (!connecting) return;
      const db = await connecting.catch(() => undefined);
      connecting = opened = undefined;
      await db?.destroy();
    },
  };
}
