// Encryption at rest (issue #212) on the SQL backend: what a stolen copy of the database or the image store shows. The contract suite
// runs encrypted too (sqlite.test.ts, postgres.test.ts); these tests read the raw rows behind the storage's back.
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { afterEach, describe, expect, test } from "vitest";
import { ReadIdTakenError, RemovedFeedError } from "../../errors";
import { CipherError } from "../cipher";
import { isKey, type ImageStore } from "../images/types";
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
// An image store in memory, to look inside.
function memoryStore(): ImageStore & { objects: Map<string, Buffer> } {
  const objects = new Map<string, Buffer>();
  return {
    objects,
    put: async (k, b) => void objects.set(k, Buffer.from(b)),
    get: async (k) => objects.get(k) ?? null,
    delete: async (k) => void objects.delete(k),
    async *list() {
      for (const [key, b] of objects) if (isKey(key)) yield { key, size: b.byteLength, modified: new Date(0) };
    },
    check: async () => {},
  };
}
const external = (ext: string) => ext === "png";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("PNGMARK"), Buffer.alloc(16, 0)]);
const ALL = ["md", "png"];

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

  test("a stolen database shows no note text or metadata", async () => {
    const url = await database();
    const s = storageOn(url, createLocalWrapper(key()));
    await s.createFeed("f", "Rid-F");
    const id = await s.writeNote("f", "n", "md", "# Plain text 123", { title: "Title 456", tags: ["tag789"] });
    await s.writeNote("f", "p", "png", PNG, { alt: "Alt 321" });
    const text = allText(await (await raw(url)).selectFrom("notes").selectAll().execute());
    for (const secret of ["Plain text 123", "Title 456", "tag789", "PNGMARK", "Alt 321"]) expect(text).not.toContain(secret);
    const note = await s.readNote("f", id, ALL, () => true);
    expect(note?.content.toString()).toBe("# Plain text 123");
    expect(note?.meta).toEqual({ title: "Title 456", tags: ["tag789"] });
    expect(note?.size).toBe(Buffer.byteLength("# Plain text 123"));
    expect((await s.readFile("f", "p.png"))?.equals(PNG)).toBe(true);
  });

  test("the image store holds no image bytes", async () => {
    const store = memoryStore();
    const s = storageOn(await database(), createLocalWrapper(key()), { store, external });
    await s.createFeed("f", "Rid-F");
    await s.writeNote("f", "p", "png", PNG, {});
    await s.writeNote("f", "p", "png", PNG, {}); // the same id again: p-2
    expect(store.objects.size).toBe(2);
    for (const b of store.objects.values()) expect(b.toString("latin1")).not.toContain("PNGMARK");
    expect((await s.readFile("f", "p.png"))?.equals(PNG)).toBe(true);
    expect((await s.readFile("f", "p-2.png"))?.equals(PNG)).toBe(true);
    expect(await s.replaceNote("f", "p", ["png"], Buffer.concat([PNG, Buffer.from("more")]))).toBe(true);
    expect((await s.readFile("f", "p.png"))?.toString("latin1")).toContain("more");
    expect(store.objects.size).toBe(2);
  });

  test("a note's bytes moved to another note do not open", async () => {
    const url = await database();
    const s = storageOn(url, createLocalWrapper(key()));
    await s.createFeed("f", "Rid-F");
    await s.writeNote("f", "a", "md", "note a", {});
    await s.writeNote("f", "b", "md", "note b", {});
    const db = await raw(url);
    const a = await db.selectFrom("notes").select("content").where("id", "=", "a").executeTakeFirstOrThrow();
    await db.updateTable("notes").set({ content: a.content }).where("id", "=", "b").execute();
    await expect(s.readNote("f", "b", ALL, () => true)).rejects.toThrow(CipherError);
    await expect(s.readFile("f", "b.md")).rejects.toThrow(CipherError);
  });

  test("moveImages keeps sealed images readable", async () => {
    const url = await database();
    const w = createLocalWrapper(key());
    const inRows = storageOn(url, w);
    await inRows.createFeed("f", "Rid-F");
    await inRows.writeNote("f", "p", "png", PNG, {});
    const store = memoryStore();
    const toStore = storageOn(url, w, { store, external });
    expect((await toStore.moveImages({ from: "db", limit: 10 })).moved.count).toBe(1);
    expect(store.objects.size).toBe(1);
    expect((await toStore.readFile("f", "p.png"))?.equals(PNG)).toBe(true);
    const back = storageOn(url, w);
    expect((await back.moveImages({ from: store, limit: 10 })).moved.count).toBe(1);
    expect((await back.readFile("f", "p.png"))?.equals(PNG)).toBe(true);
  });

  test("editing a note's metadata keeps it sealed and readable", async () => {
    const url = await database();
    const s = storageOn(url, createLocalWrapper(key()));
    await s.createFeed("f", "Rid-F");
    await s.writeNote("f", "n", "md", "text", { tags: ["a"] });
    expect(await s.updateMeta("f", "n", ALL, { title: "Secret title", tags: ["b"] })).toBe(true);
    expect(await s.readMeta("f", { id: "n", ext: "md" })).toEqual({ title: "Secret title", tags: ["b"] });
    expect(allText(await (await raw(url)).selectFrom("notes").selectAll().execute())).not.toContain("Secret title");
  });
});
