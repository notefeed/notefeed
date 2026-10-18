// A database's keys (issue #212, ADR 0033): the fingerprint key, made on first use and stored wrapped by the main key, and the
// feeds' data keys, unwrapped on demand and kept in memory. The main key itself is never stored.
import type { Kysely } from "kysely";
import { fingerprint, newDataKey, type FingerprintKind } from "../cipher";
import type { KeyWrapper } from "../wrapper";
import type { Kind } from "./migrations";
import type { Schema } from "./schema";

export type Keyring = {
  fingerprint(kind: FingerprintKind, value: string): string;
  /** The feed's data key, unwrapped. Only for a row whose key_id is set. */
  feedKey(row: { data_key: string | null; key_id: string | null }): Promise<Buffer>;
  newFeedKey(): Promise<{ key: Buffer; data_key: string; key_id: string }>;
};

const CACHED = 10_000;
const FINGERPRINT = "fingerprint";

/** null without a main key: the database is plain. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function openKeyring(db: Kysely<Schema>, kind: Kind, wrapper: KeyWrapper | null): Promise<Keyring | null> {
  if (!wrapper) return null;
  const read = () => db.selectFrom("keyring").select(["key_id", "wrapped"]).where("name", "=", FINGERPRINT).executeTakeFirst();
  let row = await read();
  if (!row) {
    // Another container may make it at the same moment: the first one in wins, and both read that one.
    await db.insertInto("keyring").values({ name: FINGERPRINT, key_id: wrapper.keyId, wrapped: await wrapper.wrap(newDataKey()) }).onConflict((oc) => oc.column("name").doNothing()).execute();
    row = (await read())!;
  }
  const fpKey = await wrapper.unwrap(row.wrapped, row.key_id);
  const cache = new Map<string, Promise<Buffer>>();
  return {
    fingerprint: (k, v) => fingerprint(fpKey, k, v),
    feedKey(r) {
      const hit = cache.get(r.data_key!);
      if (hit) return hit;
      if (cache.size >= CACHED) cache.clear();
      const p = wrapper.unwrap(r.data_key!, r.key_id!);
      cache.set(r.data_key!, p);
      p.catch(() => cache.delete(r.data_key!));
      return p;
    },
    async newFeedKey() {
      const key = newDataKey();
      return { key, data_key: await wrapper.wrap(key), key_id: wrapper.keyId };
    },
  };
}
