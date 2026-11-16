// What protects a feed and whose it is, in the one value the storage keeps for it (readHash/writeHash; sealed with the feed's key on
// an encrypted database, V4): its owner, an account's id (ADR 0059), and its feed entries, each named, hashed and revocable on its
// own. A feed from before owners stored one bare scrypt hash: that reads as one password named "Feed password", and a feed that is
// still only that is written back the same way, so its scripts and unlock cookies keep working. Must not import storage.
export type FeedPassword = { id: string; name: string; hash: string; created: number };
export type FeedRecord = { owner?: string; entries: FeedPassword[] };

export const LEGACY_ID = "feed-password";
export const LEGACY_NAME = "Feed password";

export function parseRecord(raw: string | null): FeedRecord | null {
  if (raw === null) return null;
  if (raw.startsWith("scrypt$")) return { entries: [{ id: LEGACY_ID, name: LEGACY_NAME, hash: raw, created: 0 }] };
  const v = JSON.parse(raw) as Partial<FeedRecord>;
  if (!Array.isArray(v.entries) || (v.owner !== undefined && typeof v.owner !== "string")) throw new Error("not a feed record");
  return { ...(v.owner ? { owner: v.owner } : {}), entries: v.entries };
}

// null: nothing to store (no owner, no password), the storage removes the value.
export function serializeRecord(rec: FeedRecord): string | null {
  if (!rec.owner && rec.entries.length === 0) return null;
  const [only, ...more] = rec.entries;
  if (!rec.owner && only && !more.length && only.id === LEGACY_ID && only.name === LEGACY_NAME) return only.hash;
  return JSON.stringify({ ...(rec.owner ? { owner: rec.owner } : {}), entries: rec.entries });
}

export const isProtected = (rec: FeedRecord | null): boolean => (rec?.entries.length ?? 0) > 0;
