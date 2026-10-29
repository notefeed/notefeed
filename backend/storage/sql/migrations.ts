// Schema changes, in order. Never edit one that has shipped; add the next. Kept in code, not files, so the standalone build has
// nothing extra to trace. Kysely's Migrator records what ran in `kysely_migration` (and, for PostgreSQL, holds a lock while it
// runs, so two containers starting together migrate once).
// The migrations run against whatever the schema was when they were written, so the database is untyped here.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Kysely, sql } from "kysely";
import { Migrator, type Migration } from "kysely/migration";

export type Kind = "sqlite" | "postgres";

const migrations = (kind: Kind): Record<string, Migration> => ({
  "001_feeds_and_notes": {
    async up(db: Kysely<any>) {
      await db.schema
        .createTable("feeds")
        .addColumn("name", "text", (c) => c.primaryKey())
        .addColumn("read_id", "text", (c) => c.notNull().unique())
        .addColumn("password_hash", "text")
        .addColumn("settings", "text")
        .addColumn("created_at", "bigint", (c) => c.notNull())
        .execute();
      await db.schema
        .createTable("notes")
        .addColumn("feed", "text", (c) => c.notNull())
        .addColumn("id", "text", (c) => c.notNull())
        .addColumn("ext", "text", (c) => c.notNull())
        .addColumn("content", sql`${sql.raw(kind === "postgres" ? "bytea" : "blob")}`, (c) => c.notNull())
        .addColumn("metadata", "text")
        .addColumn("created_at", "bigint", (c) => c.notNull())
        .addColumn("updated_at", "bigint", (c) => c.notNull())
        .addPrimaryKeyConstraint("notes_pk", ["feed", "id"])
        .addForeignKeyConstraint("notes_feed_fk", ["feed"], "feeds", ["name"], (c) => c.onDelete("cascade"))
        .execute();
      await db.schema.createIndex("notes_by_time").on("notes").columns(["feed", "created_at"]).execute();
    },
  },
  // Image bytes may live in an image store (storage/images): the row then holds the key and an empty `content`, which stays NOT NULL
  // because SQLite cannot drop that without rebuilding the table. `size` is the content's, wherever it is.
  "002_image_store": {
    async up(db: Kysely<any>) {
      await db.schema.alterTable("notes").addColumn("blob_key", "text").execute();
      await db.schema.alterTable("notes").addColumn("size", "bigint", (c) => c.notNull().defaultTo(0)).execute();
      await sql`update notes set size = octet_length(content)`.execute(db);
    },
  },
  // The operator's takedown (issue #155): tombstones hold the name and the read id of a removed feed for good, blocked_images the
  // hashes of images that may not come back.
  "003_takedown": {
    async up(db: Kysely<any>) {
      await db.schema
        .createTable("tombstones")
        .addColumn("name", "text", (c) => c.primaryKey())
        .addColumn("read_id", "text")
        .addColumn("removed_at", "bigint", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("tombstones_by_read_id").on("tombstones").column("read_id").execute();
      await db.schema
        .createTable("blocked_images")
        .addColumn("hash", "text", (c) => c.primaryKey())
        .addColumn("added_at", "bigint", (c) => c.notNull())
        .execute();
    },
  },
  // Encryption at rest (issue #212, ADR 0033). The keyring holds the database's fingerprint key, wrapped by the main key. A feed's
  // own data key is in its row, wrapped too; `key_id` names the main key that wrapped it (null: the feed is plain). A note or a
  // tombstone says whether it is sealed; its key is its feed's, or for a tombstone none (fingerprints only).
  "004_encryption": {
    async up(db: Kysely<any>) {
      await db.schema
        .createTable("keyring")
        .addColumn("name", "text", (c) => c.primaryKey())
        .addColumn("key_id", "text", (c) => c.notNull())
        .addColumn("wrapped", "text", (c) => c.notNull())
        .execute();
      for (const column of ["key_id", "data_key", "name_sealed", "read_id_sealed"]) await db.schema.alterTable("feeds").addColumn(column, "text").execute();
      await db.schema.alterTable("notes").addColumn("sealed", "integer", (c) => c.notNull().defaultTo(0)).execute();
      await db.schema.createIndex("notes_by_sealed").on("notes").column("sealed").execute();
      await db.schema.alterTable("tombstones").addColumn("sealed", "integer", (c) => c.notNull().defaultTo(0)).execute();
    },
  },
  // A note's date (ms), its own and not its id's: the feed is ordered by it, newest first, ties by id. Readable without decrypting.
  // Notes from before read as 0 until the start-up migration fills it from their ids.
  "005_note_date": {
    async up(db: Kysely<any>) {
      await db.schema.alterTable("notes").addColumn("date", "bigint", (c) => c.notNull().defaultTo(0)).execute();
      await db.schema.createIndex("notes_by_date").on("notes").columns(["feed", "date", "id"]).execute();
    },
  },
  // What has been done once for the whole database, by name, in plain columns (readable without a key): "note-ids", the start-up
  // migration to opaque ids completed a pass.
  "006_markers": {
    async up(db: Kysely<any>) {
      await db.schema
        .createTable("markers")
        .addColumn("name", "text", (c) => c.primaryKey())
        .addColumn("at", "bigint", (c) => c.notNull())
        .execute();
    },
  },
  // A note's draft flag (#265), plain beside its date: 1 for a draft, which listings leave out unless they ask. The index leads with it,
  // so a reader's listing (draft = 0) and the owner's (both) are each one range of it.
  "007_note_draft": {
    async up(db: Kysely<any>) {
      await db.schema.alterTable("notes").addColumn("draft", "integer", (c) => c.notNull().defaultTo(0)).execute();
      await db.schema.dropIndex("notes_by_date").ifExists().execute();
      await db.schema.createIndex("notes_by_draft_date").on("notes").columns(["feed", "draft", "date", "id"]).execute();
    },
  },
  // The takedown of one post (issue #159): the ids of a feed's notes the operator removed, held for good and gone with the feed. `feed`
  // is the notes' own key (a fingerprint once the feed is sealed), so the keyring's sealing pass moves them with the notes.
  "008_note_tombstones": {
    async up(db: Kysely<any>) {
      await db.schema
        .createTable("note_tombstones")
        .addColumn("feed", "text", (c) => c.notNull())
        .addColumn("id", "text", (c) => c.notNull())
        .addColumn("removed_at", "bigint", (c) => c.notNull())
        .addPrimaryKeyConstraint("note_tombstones_pk", ["feed", "id"])
        .addForeignKeyConstraint("note_tombstones_feed_fk", ["feed"], "feeds", ["name"], (c) => c.onDelete("cascade"))
        .execute();
    },
  },
});

/** Every migration's name, in order; the tests check the count the migrator recorded against it, so a new one changes no test. */
export const MIGRATION_NAMES: readonly string[] = Object.keys(migrations("sqlite"));

// A migration table that names one this code does not have: the database was made by a newer notefeed.
export const NEWER = "the database was made by a newer notefeed than this one; upgrade notefeed, do not point an older one at it";

export async function migrate(db: Kysely<any>, kind: Kind): Promise<void> {
  const migrator = new Migrator({ db, provider: { getMigrations: async () => migrations(kind) } });
  const { error } = await migrator.migrateToLatest();
  if (!error) return;
  if (error instanceof Error && /migration/i.test(error.message) && /missing/i.test(error.message)) throw new Error(NEWER);
  throw error;
}
