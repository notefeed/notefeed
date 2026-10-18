// Encryption at rest (issue #212) on the SQL backend: what a stolen copy of the database or the image store shows. The contract suite
// runs encrypted too (sqlite.test.ts, postgres.test.ts); these tests read the raw rows behind the storage's back.
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { afterEach, describe, expect, test } from "vitest";
import { ReadIdTakenError, RemovedFeedError } from "../../errors";
import { createLocalWrapper, type KeyWrapper } from "../wrapper";
import { connect } from "./connect";
import { createSqlStorage, type Images, type SqlStorage } from ".";
import type { Schema } from "./schema";

const supported = Number(process.versions.node.split(".")[0]) >= 22;
const key = () => randomBytes(32).toString("hex");

const opened: { close(): Promise<void> }[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const o of opened.splice(0)) await o.close();
  for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true });
});

async function database() {
  const root = await mkdtemp(join(tmpdir(), "notefeed-enc-"));
  roots.push(root);
  return `file:${join(root, "test.db")}`;
}
function storageOn(url: string, wrapper: KeyWrapper | null, images?: Images): SqlStorage {
  const s = createSqlStorage(() => connect("sqlite", url), "sqlite", images, wrapper);
  opened.push(s);
  return s;
}
// A second connection to the same file: what a thief with a copy sees.
async function raw(url: string): Promise<Kysely<Schema>> {
  const db = await connect("sqlite", url);
  opened.push({ close: () => db.destroy() });
  return db;
}
const allText = (rows: object[]) => JSON.stringify(rows, (_k, v) => (Buffer.isBuffer(v) || v instanceof Uint8Array ? Buffer.from(v).toString("latin1") : v));

describe.skipIf(!supported)("encryption at rest: sqlite", () => {
  test("a stolen database shows no feed name, read id, settings or password hash", async () => {
    const url = await database();
    const w = createLocalWrapper(key());
    const s = storageOn(url, w);
    await s.createFeed("secret-feed", "Rid-Secret-1", "hash-xyz");
    await s.writeSettings("secret-feed", { title: "Title XYZ", description: "", image: "", showSender: false });
    const db = await raw(url);
    const feeds = await db.selectFrom("feeds").selectAll().execute();
    const keyring = await db.selectFrom("keyring").selectAll().execute();
    for (const secret of ["secret-feed", "Rid-Secret-1", "hash-xyz", "Title XYZ"]) expect(allText([...feeds, ...keyring])).not.toContain(secret);
    expect(feeds[0].key_id).toBe(w.keyId);
    expect(await s.readHash("secret-feed")).toBe("hash-xyz");
    expect((await s.readSettings("secret-feed")).title).toBe("Title XYZ");
    expect(await s.feedReadId("secret-feed")).toBe("Rid-Secret-1");
  });

  test("a tombstone shows no name or read id", async () => {
    const url = await database();
    const s = storageOn(url, createLocalWrapper(key()));
    await s.createFeed("secret-feed", "Rid-Secret-1");
    expect((await s.takedownFeed("secret-feed", null)).removed).toBe(true);
    const db = await raw(url);
    const text = allText(await db.selectFrom("tombstones").selectAll().execute());
    expect(text).not.toContain("secret-feed");
    expect(text).not.toContain("Rid-Secret-1");
    await expect(s.createFeed("secret-feed", "Other-1")).rejects.toThrow(RemovedFeedError);
    await expect(s.createFeed("new-feed", "Rid-Secret-1")).rejects.toThrow(ReadIdTakenError);
    expect(await s.isRemoved({ readId: "Rid-Secret-1" })).toBe(true);
  });

  test("feedForReadId and listFeeds give plain names back", async () => {
    const s = storageOn(await database(), createLocalWrapper(key()));
    await s.createFeed("b-feed", "Rid-B");
    await s.createFeed("a-feed", "Rid-A");
    expect(await s.feedForReadId("Rid-B")).toBe("b-feed");
    expect(await s.listFeeds()).toEqual(["a-feed", "b-feed"]);
    expect(await s.listFeedNames()).toEqual(["a-feed", "b-feed"]);
  });

  test("two feeds have different data keys", async () => {
    const url = await database();
    const s = storageOn(url, createLocalWrapper(key()));
    await s.createFeed("one", "Rid-1");
    await s.createFeed("two", "Rid-2");
    const rows = await (await raw(url)).selectFrom("feeds").select("data_key").execute();
    expect(rows[0].data_key).toBeTruthy();
    expect(rows[0].data_key).not.toBe(rows[1].data_key);
  });
});
