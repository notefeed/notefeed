// The license store (ADR 0029) on a SQLite file of its own. Uniqueness is the database's: one license per feed, one per key hash and one
// per provider reference are constraints, so attaching and a webhook delivered twice stay right.
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Kysely, SqliteDialect, type ColumnType, type Selectable } from "kysely";
import { Migrator, type Migration } from "kysely/migration";
import type { AttachResult, License, LicenseStatus, LicenseStore } from "./licenses";

type Time = ColumnType<number | string, number, number>;
interface LicenseSchema {
  licenses: {
    id: string;
    key_hash: string;
    feed: string | null;
    status: string;
    provider_ref: string | null;
    valid_until: Time | null;
    created_at: Time;
  };
}

// Never edit one that has shipped; add the next.
const migrations: Record<string, Migration> = {
  "001_licenses": {
    async up(db: Kysely<any>) { // eslint-disable-line @typescript-eslint/no-explicit-any
      await db.schema
        .createTable("licenses")
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("key_hash", "text", (c) => c.notNull().unique())
        .addColumn("feed", "text", (c) => c.unique())
        .addColumn("status", "text", (c) => c.notNull())
        .addColumn("provider_ref", "text", (c) => c.unique())
        .addColumn("valid_until", "bigint")
        .addColumn("created_at", "bigint", (c) => c.notNull())
        .execute();
    },
  },
};

const code = (e: unknown) => String((e as { code?: unknown })?.code ?? "");
const isUnique = (e: unknown) => code(e) === "SQLITE_CONSTRAINT_UNIQUE" || code(e) === "SQLITE_CONSTRAINT_PRIMARYKEY";

type Row = Selectable<LicenseSchema["licenses"]>;
const licenseOf = (r: Row): License => ({
  id: r.id,
  feed: r.feed,
  status: r.status === "active" ? "active" : "lapsed",
  providerRef: r.provider_ref,
  validUntil: r.valid_until === null ? null : Number(r.valid_until),
});

export type LicenseDb = LicenseStore & { close(): Promise<void> };

/** `file`: the SQLite file, made (with its folder) on first use. */
export function createLicenseDb(file: string): LicenseDb {
  let opened: Promise<Kysely<LicenseSchema>> | undefined;
  const open = (): Promise<Kysely<LicenseSchema>> =>
    (opened ??= (async () => {
      const { default: Database } = await import("better-sqlite3");
      if (file !== ":memory:") await mkdir(/*turbopackIgnore: true*/ dirname(file), { recursive: true });
      const database = new Database(file);
      database.pragma("journal_mode = WAL");
      const db = new Kysely<LicenseSchema>({ dialect: new SqliteDialect({ database }) });
      const { error } = await new Migrator({ db, provider: { getMigrations: async () => migrations } }).migrateToLatest();
      if (error) {
        await db.destroy();
        throw error;
      }
      return db;
    })().catch((err) => {
      opened = undefined; // a failed start is tried again by the next call
      throw err;
    }));

  const find = async (column: "key_hash" | "feed" | "provider_ref", value: string) => {
    const r = await (await open()).selectFrom("licenses").selectAll().where(column, "=", value).executeTakeFirst();
    return r ? licenseOf(r) : null;
  };
  return {
    async createLicense({ keyHash, providerRef, validUntil }) {
      const db = await open();
      try {
        const id = randomUUID();
        await db.insertInto("licenses").values({ id, key_hash: keyHash, feed: null, status: "active", provider_ref: providerRef, valid_until: validUntil, created_at: Date.now() }).execute();
        return { id, feed: null, status: "active", providerRef, validUntil };
      } catch (err) {
        // The same subscription twice: the webhook came again, and the first license stands.
        const existing = isUnique(err) && providerRef !== null ? await find("provider_ref", providerRef) : null;
        if (existing) return existing;
        throw err;
      }
    },
    byKeyHash: (keyHash) => find("key_hash", keyHash),
    byFeed: (feed) => find("feed", feed),
    byProviderRef: (providerRef) => find("provider_ref", providerRef),
    async attach(keyHash, feed): Promise<AttachResult> {
      const db = await open();
      try {
        const r = await db.updateTable("licenses").set({ feed }).where("key_hash", "=", keyHash).executeTakeFirst();
        return Number(r.numUpdatedRows) > 0 ? "attached" : "unknown-key";
      } catch (err) {
        if (isUnique(err)) return "feed-has-license";
        throw err;
      }
    },
    async detach(feed) {
      const r = await (await open()).updateTable("licenses").set({ feed: null }).where("feed", "=", feed).executeTakeFirst();
      return Number(r.numUpdatedRows) > 0;
    },
    async update(providerRef, patch) {
      const set: { status?: LicenseStatus; valid_until?: number | null } = {};
      if (patch.status !== undefined) set.status = patch.status;
      if (patch.validUntil !== undefined) set.valid_until = patch.validUntil;
      const db = await open();
      if (Object.keys(set).length === 0) return (await find("provider_ref", providerRef)) !== null;
      const r = await db.updateTable("licenses").set(set).where("provider_ref", "=", providerRef).executeTakeFirst();
      return Number(r.numUpdatedRows) > 0;
    },
    async close() {
      if (opened) await (await opened).destroy();
      opened = undefined;
    },
  };
}
