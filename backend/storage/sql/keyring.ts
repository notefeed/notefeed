// A database's keys (issue #212, ADR 0033): the fingerprint key, made on first use and stored wrapped by the main key, and the
// feeds' data keys, unwrapped on demand and kept in memory. The main key itself is never stored.
//
// Opening it is also where the database comes to the main key it is given, before anything is served, in one transaction:
//   - without a main key, an encrypted database is refused;
//   - a key wrapped by a main key that is neither the current nor an old one is refused;
//   - keys wrapped by an old main key are wrapped again under the current one (no note or image is touched);
//   - a plain database is converted: feeds get data keys, names and read ids become fingerprints. Plain notes stay plain until
//     reseal, and read as they are meanwhile.
import { sql, type Kysely, type Transaction } from "kysely";
import { fingerprint, newDataKey, sealText, type FingerprintKind } from "../cipher";
import type { KeyWrapper } from "../wrapper";
import type { Kind } from "./migrations";
import type { Schema } from "./schema";

export type Keyring = {
  fingerprint(kind: FingerprintKind, value: string): string;
  /** The feed's data key, unwrapped. Only for a row whose key_id is set; `name` is the feed's fingerprint, which the key is bound to. */
  feedKey(row: { name: string; data_key: string | null; key_id: string | null }): Promise<Buffer>;
  /** A data key for the feed with this fingerprint. */
  newFeedKey(name: string): Promise<{ key: Buffer; data_key: string; key_id: string }>;
};

/** A database this main key cannot open. Its message is safe to show: it names no secret. */
export class KeyringError extends Error {}
export const ENCRYPTED_NO_KEY = "the database is encrypted, but NOTEFEED_ENCRYPTION_KEY is not set";
export const unknownKey = (id: string): string =>
  `the database holds keys wrapped by a main key notefeed does not have (key id ${id}); start once with that key in NOTEFEED_ENCRYPTION_OLD_KEYS to re-wrap them under NOTEFEED_ENCRYPTION_KEY`;

export const MIXED =
  "the database holds a feed or a tombstone both plain and encrypted: a notefeed without NOTEFEED_ENCRYPTION_KEY wrote to it after it was encrypted. Stop every notefeed, delete the plain duplicate (its key_id is null) or restore a backup, then start them all with the key";
export const KEYRING_MISSING = "the database is encrypted, but its keyring is missing (restored in part?); restore the keyring table with the rest of the database";

const CACHED = 10_000;
const FINGERPRINT = "fingerprint";
// Any number, the same in every container: PostgreSQL holds it for the transaction, so two starting together convert once.
const LOCK = 212;

async function encrypted(db: Kysely<Schema>): Promise<boolean> {
  const one = async (q: Promise<unknown>) => (await q) !== undefined;
  return (
    (await one(db.selectFrom("keyring").select("name").executeTakeFirst())) ||
    (await one(db.selectFrom("feeds").select("name").where("key_id", "is not", null).executeTakeFirst())) ||
    (await one(db.selectFrom("notes").select("id").where("sealed", "=", 1).executeTakeFirst())) ||
    (await one(db.selectFrom("tombstones").select("name").where("sealed", "=", 1).executeTakeFirst()))
  );
}

/**
 * A key of the keyring table (`name`: "fingerprint", or "data" in the licenses database), made, or wrapped again under the current
 * main key. Shared by both databases, whose schemas differ elsewhere; hence the untyped transaction.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ringKey(tx: Transaction<any>, name: string, wrapper: KeyWrapper): Promise<Buffer> {
  const read = (): Promise<{ key_id: string; wrapped: string } | undefined> => tx.selectFrom("keyring").select(["key_id", "wrapped"]).where("name", "=", name).executeTakeFirst();
  const row = await read();
  if (!row) {
    const key = newDataKey();
    const wrapped = await wrapper.wrap(key, `keyring:${name}`);
    await tx.insertInto("keyring").values({ name, key_id: wrapper.keyId, wrapped }).onConflict((oc) => oc.column("name").doNothing()).execute();
    // Another start may have made one first (SQLite has no lock to wait on): theirs wins.
    const won = (await read())!;
    return won.wrapped === wrapped ? key : wrapper.unwrap(won.wrapped, won.key_id, `keyring:${name}`);
  }
  const key = await wrapper.unwrap(row.wrapped, row.key_id, `keyring:${name}`);
  if (row.key_id !== wrapper.keyId) await tx.updateTable("keyring").set({ key_id: wrapper.keyId, wrapped: await wrapper.wrap(key, `keyring:${name}`) }).where("name", "=", name).execute();
  return key;
}

async function prepare(tx: Transaction<Schema>, kind: Kind, wrapper: KeyWrapper): Promise<Buffer> {
  if (kind === "postgres") await sql`select pg_advisory_xact_lock(${LOCK})`.execute(tx);
  const ring = await tx.selectFrom("keyring").select("key_id").execute();
  const feedIds = await tx.selectFrom("feeds").select("key_id").distinct().where("key_id", "is not", null).execute();
  for (const { key_id } of [...ring, ...feedIds]) if (!wrapper.knows(key_id!)) throw new KeyringError(unknownKey(key_id!));

  // Encrypted data without its keyring: a new fingerprint key would find nothing and let every name be taken again.
  if (ring.length === 0 && (feedIds.length > 0 || (await tx.selectFrom("tombstones").select("name").where("sealed", "=", 1).executeTakeFirst()) || (await tx.selectFrom("notes").select("id").where("sealed", "=", 1).executeTakeFirst()))) {
    throw new KeyringError(KEYRING_MISSING);
  }
  const fpKey = await ringKey(tx, FINGERPRINT, wrapper);
  // A plain row whose fingerprint is already there was written by a notefeed without the key, after the conversion.
  const taken = async (table: "feeds" | "tombstones", column: "name" | "read_id", value: string) => (await tx.selectFrom(table).select("name").where(column, "=", value).executeTakeFirst()) !== undefined;

  // Wrapped by an old main key: the same data key, wrapped again.
  const old = await tx.selectFrom("feeds").select(["name", "data_key", "key_id"]).where("key_id", "is not", null).where("key_id", "!=", wrapper.keyId).execute();
  for (const f of old) {
    const key = await wrapper.unwrap(f.data_key!, f.key_id!, `feed:${f.name}`);
    await tx.updateTable("feeds").set({ key_id: wrapper.keyId, data_key: await wrapper.wrap(key, `feed:${f.name}`) }).where("name", "=", f.name).execute();
  }

  // Plain feeds: a new row under the fingerprint, the notes moved to it, the old row gone (its notes are no longer on it).
  const plain = await tx.selectFrom("feeds").selectAll().where("key_id", "is", null).execute();
  for (const f of plain) {
    const key = newDataKey();
    const name = fingerprint(fpKey, "feed", f.name);
    if ((await taken("feeds", "name", name)) || (await taken("feeds", "read_id", fingerprint(fpKey, "read_id", f.read_id)))) throw new KeyringError(MIXED);
    await tx
      .insertInto("feeds")
      .values({
        name,
        read_id: fingerprint(fpKey, "read_id", f.read_id),
        password_hash: f.password_hash === null ? null : sealText(key, f.password_hash, `feed:${name}:hash`),
        settings: f.settings === null ? null : sealText(key, f.settings, `feed:${name}:settings`),
        created_at: Number(f.created_at),
        key_id: wrapper.keyId,
        data_key: await wrapper.wrap(key, `feed:${name}`),
        name_sealed: sealText(key, f.name, `feed:${name}:name`),
        read_id_sealed: sealText(key, f.read_id, `feed:${name}:read_id`),
      })
      .execute();
    await tx.updateTable("notes").set({ feed: name }).where("feed", "=", f.name).execute();
    await tx.deleteFrom("feeds").where("name", "=", f.name).execute();
  }

  const stones = await tx.selectFrom("tombstones").select(["name", "read_id"]).where("sealed", "=", 0).execute();
  for (const t of stones) {
    if (await taken("tombstones", "name", fingerprint(fpKey, "feed", t.name))) throw new KeyringError(MIXED);
    await tx
      .updateTable("tombstones")
      .set({ name: fingerprint(fpKey, "feed", t.name), read_id: t.read_id === null ? null : fingerprint(fpKey, "read_id", t.read_id), sealed: 1 })
      .where("name", "=", t.name)
      .execute();
  }
  return fpKey;
}

/** null without a main key: the database is plain (and an encrypted one is refused). */
export async function openKeyring(db: Kysely<Schema>, kind: Kind, wrapper: KeyWrapper | null): Promise<Keyring | null> {
  if (!wrapper) {
    if (await encrypted(db)) throw new KeyringError(ENCRYPTED_NO_KEY);
    return null;
  }
  const fpKey = await db.transaction().execute((tx) => prepare(tx, kind, wrapper));
  const cache = new Map<string, Promise<Buffer>>();
  return {
    fingerprint: (k, v) => fingerprint(fpKey, k, v),
    feedKey(r) {
      const hit = cache.get(r.data_key!);
      if (hit) return hit;
      if (cache.size >= CACHED) cache.clear();
      const p = wrapper.unwrap(r.data_key!, r.key_id!, `feed:${r.name}`);
      cache.set(r.data_key!, p);
      p.catch(() => cache.delete(r.data_key!));
      return p;
    },
    async newFeedKey(name) {
      const key = newDataKey();
      return { key, data_key: await wrapper.wrap(key, `feed:${name}`), key_id: wrapper.keyId };
    },
  };
}
