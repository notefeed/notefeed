// The license store on the database (ADR 0029). Uniqueness is the database's: one license per feed, one per key hash and one per
// provider reference are constraints, so attaching and a webhook delivered twice stay right with several containers.
import { randomUUID } from "node:crypto";
import type { Kysely, Selectable } from "kysely";
import type { AttachResult, License, LicenseStatus, LicenseStore } from "../licenses";
import type { Schema } from "./schema";

const code = (e: unknown) => String((e as { code?: unknown })?.code ?? "");
const isForeignKey = (e: unknown) => code(e) === "23503" || code(e) === "SQLITE_CONSTRAINT_FOREIGNKEY";
const isUnique = (e: unknown) => code(e) === "23505" || code(e) === "SQLITE_CONSTRAINT_UNIQUE" || code(e) === "SQLITE_CONSTRAINT_PRIMARYKEY";

type Row = Selectable<Schema["licenses"]>;
const licenseOf = (r: Row): License => ({
  id: r.id,
  feed: r.feed,
  status: r.status === "active" ? "active" : "lapsed",
  providerRef: r.provider_ref,
  validUntil: r.valid_until === null ? null : Number(r.valid_until),
});

export function sqlLicenses(open: () => Promise<Kysely<Schema>>): LicenseStore {
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
        if (isForeignKey(err)) return "no-feed";
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
  };
}
