// The license store (ADR 0029) on a SQLite file of its own. Uniqueness is the database's: one license per feed, one per key hash and one
// per provider reference are constraints, so attaching and a webhook delivered twice stay right.
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Kysely, SqliteDialect, type ColumnType, type Selectable } from "kysely";
import { Migrator, type Migration } from "kysely/migration";
import type { AttachResult, License, LicenseCounts, LicenseStatus, LicenseStore } from "./licenses";
import { fingerprint, openText, sealText } from "./cipher";
import { ENCRYPTED_NO_KEY, KEYRING_MISSING, KeyringError, ringKey, unknownKey } from "./sql/keyring";
import type { KeyWrapper } from "./wrapper";
import { logger } from "../log";

const log = logger("licenses");

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
    // Encryption at rest (issue #212): 1 when `feed` and `provider_ref` are fingerprints, their values sealed beside them.
    sealed: ColumnType<number, number | undefined, number>;
    feed_sealed: string | null;
    provider_ref_sealed: string | null;
  };
  keyring: { name: string; key_id: string; wrapped: string };
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
  // Encryption at rest (issue #212, ADR 0033): the keyring holds this file's fingerprint key and its one data key, wrapped by the
  // main key. Licenses are few and small: one data key for all of them.
  "002_encryption": {
    async up(db: Kysely<any>) { // eslint-disable-line @typescript-eslint/no-explicit-any
      await db.schema
        .createTable("keyring")
        .addColumn("name", "text", (c) => c.primaryKey())
        .addColumn("key_id", "text", (c) => c.notNull())
        .addColumn("wrapped", "text", (c) => c.notNull())
        .execute();
      await db.schema.alterTable("licenses").addColumn("sealed", "integer", (c) => c.notNull().defaultTo(0)).execute();
      await db.schema.alterTable("licenses").addColumn("feed_sealed", "text").execute();
      await db.schema.alterTable("licenses").addColumn("provider_ref_sealed", "text").execute();
    },
  },
};

type Keys = { fp: Buffer; data: Buffer };
const inLicenses = (m: string) => m.replace("the database", "the license database");

// The file comes to the main key it is given, as the feeds' database does (sql/keyring.ts): refused without it or with an unknown
// one, re-wrapped under a new one, converted when plain.
async function prepareKeys(db: Kysely<LicenseSchema>, wrapper: KeyWrapper | null): Promise<Keys | null> {
  if (!wrapper) {
    const ring = await db.selectFrom("keyring").select("name").executeTakeFirst();
    const sealed = await db.selectFrom("licenses").select("id").where("sealed", "=", 1).executeTakeFirst();
    if (ring || sealed) throw new KeyringError(inLicenses(ENCRYPTED_NO_KEY));
    return null;
  }
  await wrapper.start();
  return db.transaction().execute(async (tx) => {
    const ring = await tx.selectFrom("keyring").select("key_id").execute();
    const older = ring.filter((r) => r.key_id !== wrapper.keyId).length;
    for (const { key_id } of ring) if (!wrapper.knows(key_id)) throw new KeyringError(inLicenses(unknownKey(key_id)));
    if (ring.length === 0 && (await tx.selectFrom("licenses").select("id").where("sealed", "=", 1).executeTakeFirst())) throw new KeyringError(inLicenses(KEYRING_MISSING));
    const keys = { fp: await ringKey(tx, "fingerprint", wrapper), data: await ringKey(tx, "data", wrapper) };
    if (older > 0) log.info({ keys: older, keyId: wrapper.keyId }, "re-wrapped the license database's keys under the current main key; none left under an older one");
    for (const r of await tx.selectFrom("licenses").select(["id", "feed", "provider_ref"]).where("sealed", "=", 0).execute()) {
      await tx.updateTable("licenses").set(sealedRefs(keys, r.id, r.feed, r.provider_ref)).where("id", "=", r.id).execute();
    }
    return keys;
  });
}

// The stored form of a license's feed and reference: fingerprints to look them up by, the values sealed to give them back.
function sealedRefs(keys: Keys, id: string, feed: string | null, providerRef: string | null) {
  return {
    feed: feed === null ? null : fingerprint(keys.fp, "feed", feed),
    feed_sealed: feed === null ? null : sealText(keys.data, feed, `license:${id}:feed`),
    provider_ref: providerRef === null ? null : fingerprint(keys.fp, "provider_ref", providerRef),
    provider_ref_sealed: providerRef === null ? null : sealText(keys.data, providerRef, `license:${id}:provider_ref`),
    sealed: 1,
  };
}

const code = (e: unknown) => String((e as { code?: unknown })?.code ?? "");
const isUnique = (e: unknown) => code(e) === "SQLITE_CONSTRAINT_UNIQUE" || code(e) === "SQLITE_CONSTRAINT_PRIMARYKEY";

type Row = Selectable<LicenseSchema["licenses"]>;
const licenseOf = (keys: Keys | null, r: Row): License => ({
  id: r.id,
  feed: keys && r.sealed && r.feed_sealed !== null ? openText(keys.data, r.feed_sealed, `license:${r.id}:feed`) : r.feed,
  status: r.status === "active" ? "active" : "lapsed",
  providerRef: keys && r.sealed && r.provider_ref_sealed !== null ? openText(keys.data, r.provider_ref_sealed, `license:${r.id}:provider_ref`) : r.provider_ref,
  validUntil: r.valid_until === null ? null : Number(r.valid_until),
});

/** `ready()` opens the file now, as the start does: so a key change re-wraps it then, and a wrong key is found then. */
export type LicenseDb = LicenseStore & { ready(): Promise<void>; close(): Promise<void> };

/** `file`: the SQLite file, made (with its folder) on first use. With a `wrapper` (the main key) it is encrypted (issue #212). */
export function createLicenseDb(file: string, wrapper: KeyWrapper | null = null): LicenseDb {
  let opened: Promise<Kysely<LicenseSchema>> | undefined;
  let keys: Keys | null = null; // set by open(), before any query
  const ident = (kind: "feed" | "provider_ref", v: string) => (keys ? fingerprint(keys.fp, kind, v) : v);
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
      try {
        keys = await prepareKeys(db, wrapper);
      } catch (e) {
        await db.destroy();
        throw e;
      }
      return db;
    })().catch((err) => {
      opened = undefined; // a failed start is tried again by the next call
      throw err;
    }));

  const find = async (column: "key_hash" | "feed" | "provider_ref", value: string) => {
    const db = await open();
    const r = await db.selectFrom("licenses").selectAll().where(column, "=", column === "key_hash" ? value : ident(column, value)).executeTakeFirst();
    return r ? licenseOf(keys, r) : null;
  };
  return {
    async createLicense({ keyHash, providerRef, validUntil }) {
      const db = await open();
      try {
        const id = randomUUID();
        const refs = keys ? sealedRefs(keys, id, null, providerRef) : { provider_ref: providerRef };
        await db.insertInto("licenses").values({ id, key_hash: keyHash, feed: null, status: "active", valid_until: validUntil, created_at: Date.now(), ...refs }).execute();
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
        // Encrypted, the sealed feed is bound to the license's id, so the row is found first.
        const row = keys ? await db.selectFrom("licenses").select("id").where("key_hash", "=", keyHash).executeTakeFirst() : undefined;
        if (keys && !row) return "unknown-key";
        const set = keys ? { feed: ident("feed", feed), feed_sealed: sealText(keys.data, feed, `license:${row!.id}:feed`) } : { feed };
        const r = await db.updateTable("licenses").set(set).where("key_hash", "=", keyHash).executeTakeFirst();
        return Number(r.numUpdatedRows) > 0 ? "attached" : "unknown-key";
      } catch (err) {
        if (isUnique(err)) return "feed-has-license";
        throw err;
      }
    },
    async detach(feed) {
      const db = await open();
      const r = await db.updateTable("licenses").set({ feed: null, feed_sealed: null }).where("feed", "=", ident("feed", feed)).executeTakeFirst();
      return Number(r.numUpdatedRows) > 0;
    },
    async update(providerRef, patch) {
      const set: { status?: LicenseStatus; valid_until?: number | null } = {};
      if (patch.status !== undefined) set.status = patch.status;
      if (patch.validUntil !== undefined) set.valid_until = patch.validUntil;
      const db = await open();
      if (Object.keys(set).length === 0) return (await find("provider_ref", providerRef)) !== null;
      const r = await db.updateTable("licenses").set(set).where("provider_ref", "=", ident("provider_ref", providerRef)).executeTakeFirst();
      return Number(r.numUpdatedRows) > 0;
    },
    // The same rule as isLicensed (backend/licensing.ts): a paid period that has ended counts as lapsed, webhook or not.
    async counts(now = Date.now()) {
      const rows = await (await open()).selectFrom("licenses").select(["status", "valid_until", "feed"]).execute();
      const c: LicenseCounts = { active: 0, unattached: 0, lapsed: 0 };
      for (const r of rows) {
        const paid = r.status === "active" && (r.valid_until === null || Number(r.valid_until) > now);
        c[!paid ? "lapsed" : r.feed === null ? "unattached" : "active"]++;
      }
      return c;
    },
    async ready() {
      await open();
    },
    async close() {
      if (opened) await (await opened).destroy();
      opened = undefined;
    },
  };
}
