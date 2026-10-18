// The database backend: SQLite and PostgreSQL through Kysely, one implementation for both. The database is the only source of truth
// (no in-memory index): uniqueness is a constraint, counts are queries, so several containers stay consistent.
import { sql, type Kysely } from "kysely";
import { NotFoundError, ReadIdTakenError, RemovedFeedError } from "../../errors";
import { logger } from "../../log";
import { noteFeedSize } from "../../metrics";
import { newKey, type ImageStore } from "../images/types";
import { applyPatch, hasMeta, parseMeta } from "../meta";
import { parseSettings, serializeSettings } from "../settings";
import { FeedGoneError, type Meta, type Storage } from "../types";
import { IMAGE_EXTS } from "../../../shared/images";
import { open as openBytes, openText, seal, sealText, type FingerprintKind } from "../cipher";
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
};

/** `skipped`: rows that changed meanwhile or were moved by an earlier run. `next`: the cursor for the next call, null when nothing is left. */
export type Move = { moved: { count: number; bytes: number }; skipped: number; missing: number; failed: number; left: number; next: string | null };

// A cursor is "<created_at>:<id>" of the last row a call examined; anything else counts as the start.
function parseCursor(c: string): { at: number; id: string } | null {
  const m = /^(\d+):(.+)$/.exec(c);
  return m ? { at: Number(m[1]), id: m[2] } : null;
}

export type Sweep = { unreferenced: { count: number; bytes: number }; deleted: { count: number; bytes: number }; failed: number; tooRecent: number; missing: number };

/** Where the bytes of the notes with an `external` extension go, instead of the row. Without it, every note's bytes are in its row. */
export type Images = { store: ImageStore; external: (ext: string) => boolean };

const log = logger("storage");
const EMPTY = Buffer.alloc(0);

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
type FeedKeys = { data_key: string | null; key_id: string | null };

// `kind` picks the dialect-specific migration; `connect` is called once, on first use. With a `wrapper` (the main key) the database
// is encrypted (issue #212): names and read ids are stored as fingerprints, a feed's values sealed with its own data key.
export function createSqlStorage(connect: () => Promise<Kysely<Schema>>, kind: Kind = "sqlite", images?: Images, wrapper: KeyWrapper | null = null): SqlStorage {
  let opened: Promise<Kysely<Schema>> | undefined;
  let ring: Keyring | null = null; // set by open(), before any query
  // What a name or a read id is stored as, and looked up by.
  const ident = (k: FingerprintKind, v: string) => (ring ? ring.fingerprint(k, v) : v);
  // A feed's data key; null for a plain feed. A row with a key_id is only read with a keyring (the keyring refuses to open otherwise).
  const keyOf = async (row: FeedKeys): Promise<Buffer | null> => (row.key_id === null ? null : ring!.feedKey(row));
  const sealIn = (key: Buffer | null, v: string, aad: string) => (key ? sealText(key, v, aad) : v);
  const openIn = (key: Buffer | null, v: string, aad: string) => (key ? openText(key, v, aad) : v);
  const nameOf = async (row: FeedKeys & { name: string; name_sealed: string | null }) => openIn(await keyOf(row), row.key_id === null ? row.name : row.name_sealed!, "feed:name");
  // A note's key: its feed's, when the note is sealed. undefined when the feed is gone meanwhile.
  const noteKey = async (db: Kysely<Schema>, feed: string, sealed: number): Promise<Buffer | null | undefined> => {
    if (!sealed) return null;
    const row = await feedKeys(db, feed);
    return row ? keyOf(row) : undefined;
  };
  // The bytes and the metadata are bound to the note's id, not to where the bytes are: moveImages copies them as they are.
  const contentIn = (key: Buffer | null, id: string, b: Buffer) => (key ? openBytes(key, b, `note:${id}:content`) : b);
  const metaIn = (key: Buffer | null, id: string, raw: string | null): Meta => (raw ? parseMeta(openIn(key, raw, `note:${id}:meta`)) : {});
  const metaOut = (key: Buffer | null, id: string, meta: Meta): string | null => (hasMeta(meta) ? sealIn(key, JSON.stringify(meta), `note:${id}:meta`) : null);
  const feedKeys = async (db: Kysely<Schema>, feed: string) => db.selectFrom("feeds").select(["data_key", "key_id"]).where("name", "=", ident("feed", feed)).executeTakeFirst();

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

  function open(): Promise<Kysely<Schema>> {
    if (opened) return opened;
    const attempt = (async () => {
      let db: Kysely<Schema> | undefined;
      try {
        db = await connect();
        await migrate(db, kind);
        ring = await openKeyring(db, kind, wrapper);
        return db;
      } catch (e) {
        await db?.destroy().catch(() => {});
        const known = e instanceof KeyringError || (e instanceof Error && e.message.startsWith("the database was made by a newer notefeed"));
        // No `cause`: the driver's error names the address or the file, and the log would carry it.
        throw known ? e : new Error(`cannot use the database named by NOTEFEED_DATABASE_URL (${code(e) || (e as Error)?.name || "error"})`);
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
    async writeNote(feed, base, ext, content, meta) {
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
          const out = fkey ? seal(fkey, data, `note:${id}:content`) : data;
          if (key && (n === 1 || fkey)) await stored(key, out);
          const r = await db
            .insertInto("notes")
            .values({ feed: f, id, ext, content: key ? EMPTY : out, blob_key: key, size: data.byteLength, metadata: metaOut(fkey, id, meta), created_at: now, updated_at: now, sealed: fkey ? 1 : 0 })
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

    async listNoteRefs(feed) {
      const rows = await (await open()).selectFrom("notes").select(["id", "ext"]).where("feed", "=", ident("feed", feed)).orderBy("created_at").orderBy("id").execute();
      noteFeedSize(rows.length);
      return rows;
    },

    async readNote(feed, id, exts, withContent) {
      if (exts.length === 0) return null;
      const db = await open();
      const row = await db
        .selectFrom("notes")
        .select(["ext", "metadata", "updated_at", "size", "sealed"])
        .where("feed", "=", ident("feed", feed))
        .where("id", "=", id)
        .where("ext", "in", exts)
        .executeTakeFirst();
      if (!row) return null;
      const key = await noteKey(db, feed, row.sealed);
      if (key === undefined) return null; // the feed went meanwhile
      let content: Buffer = EMPTY;
      if (withContent(row.ext)) {
        const full = await db.selectFrom("notes").select(["content", "blob_key"]).where("feed", "=", ident("feed", feed)).where("id", "=", id).executeTakeFirst();
        const found = full && (await bytesOf(full));
        if (!found) return null; // deleted since the first read, or its object is gone
        content = contentIn(key, id, found);
      }
      return { ext: row.ext, content, size: Number(row.size), meta: metaIn(key, id, row.metadata), mtime: new Date(Number(row.updated_at)) };
    },

    async readMeta(feed, ref) {
      const db = await open();
      const row = await db.selectFrom("notes").select(["metadata", "sealed"]).where("feed", "=", ident("feed", feed)).where("id", "=", ref.id).where("ext", "=", ref.ext).executeTakeFirst();
      if (!row) return null;
      const key = await noteKey(db, feed, row.sealed);
      return key === undefined ? null : metaIn(key, ref.id, row.metadata);
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
          const out = nkey ? seal(nkey, data, `note:${id}:content`) : data;
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
      return (await open()).transaction().execute(async (tx) => {
        const row = await tx.selectFrom("notes").select(["ext", "metadata", "sealed"]).where("feed", "=", ident("feed", feed)).where("id", "=", id).where("ext", "in", exts).executeTakeFirst();
        if (!row) return false;
        const key = await noteKey(tx, feed, row.sealed);
        if (key === undefined) return false;
        const merged = applyPatch(metaIn(key, id, row.metadata), patch);
        await tx.updateTable("notes").set({ metadata: metaOut(key, id, merged) }).where("feed", "=", ident("feed", feed)).where("id", "=", id).execute();
        return true;
      });
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
      const row = await db.selectFrom("notes").select(["content", "blob_key", "sealed"]).where("feed", "=", ident("feed", feed)).where("id", "=", m[1]).where("ext", "=", m[2]).executeTakeFirst();
      if (!row) return null;
      const key = await noteKey(db, feed, row.sealed);
      const found = key === undefined ? null : await bytesOf(row);
      return found && contentIn(key!, m[1], found);
    },

    async readSettings(feed) {
      const row = await (await open()).selectFrom("feeds").select(["settings", "data_key", "key_id"]).where("name", "=", ident("feed", feed)).executeTakeFirst();
      if (!row?.settings) return parseSettings(null);
      return parseSettings(openIn(await keyOf(row), row.settings, "feed:settings"));
    },
    async writeSettings(feed, s) {
      const db = await open();
      const row = await feedKeys(db, feed);
      if (!row) throw new FeedGoneError();
      const r = await db.updateTable("feeds").set({ settings: sealIn(await keyOf(row), serializeSettings(s), "feed:settings") }).where("name", "=", ident("feed", feed)).where("data_key", row.data_key === null ? "is" : "=", row.data_key).executeTakeFirst();
      if (!changed(r.numUpdatedRows)) throw new FeedGoneError();
    },
    async readHash(feed) {
      const row = await (await open()).selectFrom("feeds").select(["password_hash", "data_key", "key_id"]).where("name", "=", ident("feed", feed)).executeTakeFirst();
      if (!row?.password_hash) return null;
      return openIn(await keyOf(row), row.password_hash, "feed:hash");
    },
    async writeHash(feed, hash) {
      const db = await open();
      const row = await feedKeys(db, feed);
      if (!row) throw new FeedGoneError();
      const r = await db.updateTable("feeds").set({ password_hash: sealIn(await keyOf(row), hash, "feed:hash") }).where("name", "=", ident("feed", feed)).where("data_key", row.data_key === null ? "is" : "=", row.data_key).executeTakeFirst();
      if (!changed(r.numUpdatedRows)) throw new FeedGoneError();
    },
    async removeHash(feed) {
      await (await open()).updateTable("feeds").set({ password_hash: null }).where("name", "=", ident("feed", feed)).execute();
    },

    async createFeed(feed, readId, hash) {
      const db = await open();
      await refuseRemoved(db, ident("feed", feed), ident("read_id", readId));
      // Encrypted: a new data key for the feed, the name and read id sealed with it next to their fingerprints.
      const k = ring ? await ring.newFeedKey() : null;
      try {
        const r = await db
          .insertInto("feeds")
          .values({
            name: ident("feed", feed),
            read_id: ident("read_id", readId),
            password_hash: hash === undefined ? null : sealIn(k?.key ?? null, hash, "feed:hash"),
            settings: null,
            created_at: Date.now(),
            key_id: k?.key_id ?? null,
            data_key: k?.data_key ?? null,
            name_sealed: k ? sealText(k.key, feed, "feed:name") : null,
            read_id_sealed: k ? sealText(k.key, readId, "feed:read_id") : null,
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
          .set({ read_id: ident("read_id", readId), read_id_sealed: key ? sealText(key, readId, "feed:read_id") : null })
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
      const row = await (await open()).selectFrom("feeds").select(["read_id", "read_id_sealed", "data_key", "key_id"]).where("name", "=", ident("feed", feed)).executeTakeFirst();
      if (!row) return undefined;
      return row.key_id === null ? row.read_id : openIn(await keyOf(row), row.read_id_sealed!, "feed:read_id");
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
    async feedCount() {
      const r = await (await open()).selectFrom("feeds").select(sql<number | string>`count(*)`.as("n")).executeTakeFirstOrThrow();
      return Number(r.n);
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
    async blockImages(hashes) {
      if (hashes.length === 0) return;
      const now = Date.now();
      await (await open()).insertInto("blocked_images").values(hashes.map((hash) => ({ hash, added_at: now }))).onConflict((oc) => oc.column("hash").doNothing()).execute();
    },
    async isBlockedImage(hash) {
      return !!(await (await open()).selectFrom("blocked_images").select("hash").where("hash", "=", hash).executeTakeFirst());
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
      const pending = (before: { at: number; id: string } | null) => {
        let q = from === "db" ? db.selectFrom("notes").where("blob_key", "is", null).where("ext", "in", EXTERNAL_EXTS()) : db.selectFrom("notes").where("blob_key", "is not", null);
        if (before) q = q.where((eb) => eb.or([eb("created_at", "<", before.at), eb.and([eb("created_at", "=", before.at), eb("id", "<", before.id)])]));
        return q;
      };
      const rows = await pending(cursor).select(["feed", "id", "blob_key", "content", "created_at"]).orderBy("created_at", "desc").orderBy("id", "desc").limit(limit).execute();
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
        const at = { at: Number(last.created_at), id: last.id };
        const r = await pending(at).select(sql<number | string>`count(*)`.as("n")).executeTakeFirstOrThrow();
        move.left = Number(r.n);
        move.next = move.left > 0 ? `${at.at}:${at.id}` : null;
      }
      log.info({ moved: move.moved.count, bytes: move.moved.bytes, skipped: move.skipped, missing: move.missing, failed: move.failed, left: move.left }, "images moved to the configured store");
      return move;
    },

    async close() {
      if (!opened) return;
      const db = await opened.catch(() => undefined);
      opened = undefined;
      await db?.destroy();
    },
  };
}
