import { randomBytes } from "node:crypto";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ensureFeed, resetFeedsForTests } from "./feeds";
import { getSettings } from "./feedsettings";
import { logsOf } from "./log";
import { migratedId, migrateNoteIds } from "./notemigration";
import { resetSecretForTests } from "./secret";
import { resetStorageForTests, storage } from "./storage";

// better-sqlite3 and kysely need Node 22 (the project's version); on an older Node the SQL tests are skipped.
const supported = Number(process.versions.node.split(".")[0]) >= 22;

// An id as notes had them before: `<stamp>-<uuid v7>`, both from `ms`, and `-n` when it was taken.
function oldId(ms: number, n?: number): string {
  const b = randomBytes(16);
  b.writeUIntBE(ms, 0, 6);
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  const stamp = new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `${stamp}-${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}${n ? `-${n}` : ""}`;
}

const AT = Date.UTC(2026, 3, 1, 12, 0, 0, 345);
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const OLD_FORM = /^\d{8}T\d{6}Z-/;

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "notefeed-migration-"));
  vi.stubEnv("DATA_DIR", dir);
  vi.stubEnv("NOTEFEED_SECRET", "m".repeat(32));
  resetSecretForTests();
  resetFeedsForTests();
  resetStorageForTests();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetFeedsForTests();
  resetStorageForTests();
  resetSecretForTests();
  await rm(dir, { recursive: true, force: true });
});

// A note stored under its old id, with a date of 0 as a database row from before dates had (the file system's is from its mtime).
async function put(feed: string, id: string, ext: string, content: string | Uint8Array, meta = {}): Promise<void> {
  await ensureFeed(feed);
  expect(await storage().writeNote(feed, id, ext, content, meta, 0)).toBe(id);
}
const refs = (feed: string) => storage().listNoteRefs(feed);
const text = async (feed: string, id: string) => (await storage().readNote(feed, id, ["md"], () => true))!.content.toString("utf8");

describe.each(["fs", "sqlite"] as const)("on %s", (kind) => {
  beforeEach(() => vi.stubEnv("NOTEFEED_STORAGE", kind));
  const run = kind === "sqlite" && !supported ? test.skip : test;

  run("old ids get derived ids and their dates", async () => {
    const ids = [oldId(AT), oldId(AT + 1000), oldId(AT + 1000, 2)];
    for (const id of ids) await put("one", id, "md", `note ${id}`);
    await put("two", ids[0], "md", "same old id, other feed");
    expect(await migrateNoteIds()).toEqual({ feeds: 2, renamed: 4, rewritten: 0 });
    const one = await refs("one");
    expect(one.some((r) => OLD_FORM.test(r.id))).toBe(false);
    expect(new Set(one.map((r) => r.id))).toEqual(new Set(ids.map((id) => migratedId("one", id))));
    for (const [i, id] of ids.entries()) {
      expect(one.find((r) => r.id === migratedId("one", id))!.date).toBe(i === 0 ? AT : AT + 1000);
      expect(await text("one", migratedId("one", id))).toBe(`note ${id}`);
    }
    expect((await refs("two")).map((r) => r.id)).toEqual([migratedId("two", ids[0])]);
    expect(migratedId("one", ids[0])).not.toBe(migratedId("two", ids[0]));
    expect(migratedId("one", ids[0])).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  run("a stamp without a uuid v7 gives the stamp's second", async () => {
    const id = "20260401T120000Z-0d9c3f2a-61b7-4e0c-9a51-3c7e2b8d4f10"; // a uuid v4: no time in it
    await put("one", id, "md", "v4");
    await migrateNoteIds();
    expect(await refs("one")).toEqual([{ id: migratedId("one", id), ext: "md", date: Date.UTC(2026, 3, 1, 12, 0, 0), draft: false }]);
  });

  run("references in the text follow", async () => {
    const img = oldId(AT - 2), other = oldId(AT - 1), late = oldId(AT - 120_000), txt = oldId(AT);
    await put("one", img, "png", PNG);
    await put("one", other, "jpg", PNG);
    await put("one", late, "png", PNG);
    await put("one", txt, "md", `![](${img}.png) and ![b](${other}.jpg), ![c](${late}.png), elsewhere https://x.example/r/a/${oldId(AT)}.png`);
    expect(await migrateNoteIds()).toEqual({ feeds: 1, renamed: 4, rewritten: 1 });
    const t = migratedId("one", txt);
    const body = await text("one", t);
    expect(body).toContain(`![](${migratedId("one", img)}.png) and ![b](${migratedId("one", other)}.jpg), ![c](${migratedId("one", late)}.png)`);
    expect(body).toMatch(/https:\/\/x\.example\/r\/a\/\d{8}T\d{6}Z-[0-9a-f-]{36}\.png$/); // another feed's file: not ours to rename
    const meta = (id: string, ext: string) => storage().readMeta("one", { id: migratedId("one", id), ext });
    expect((await meta(img, "png"))?.of).toBe(t);
    expect((await meta(other, "jpg"))?.of).toBe(t);
    expect((await meta(late, "png"))?.of).toBeUndefined(); // over a minute before the text: not posted with it
  });

  run("a second run changes nothing, and reads nothing: a completed pass is marked", async () => {
    const img = oldId(AT - 1), txt = oldId(AT);
    await put("one", img, "png", PNG);
    await put("one", txt, "md", `![](${img}.png)`);
    expect(await storage().migrationPending()).toBe(true);
    await migrateNoteIds();
    expect(await storage().migrationPending()).toBe(false);
    const before = await refs("one");
    const body = await text("one", migratedId("one", txt));
    const reads = [vi.spyOn(storage(), "listFeeds"), vi.spyOn(storage(), "listNoteRefs"), vi.spyOn(storage(), "readNote")];
    expect(await migrateNoteIds()).toEqual({ feeds: 0, renamed: 0, rewritten: 0 });
    for (const spy of reads) expect(spy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    expect(await refs("one")).toEqual(before);
    expect(await text("one", migratedId("one", txt))).toBe(body);
  });

  run("a note dated 0 after the migration keeps its date at every start", async () => {
    await put("one", oldId(AT), "md", "before");
    await migrateNoteIds();
    await storage().writeNote("one", "epoch", "md", "posted with X-Note-Date: 1970-01-01", {}, 0);
    await migrateNoteIds();
    await migrateNoteIds();
    expect((await refs("one")).find((r) => r.id === "epoch")?.date).toBe(0);
  });

  run("a store without notes is marked at its first start", async () => {
    await ensureFeed("one");
    expect(await storage().migrationPending()).toBe(false);
    expect(await migrateNoteIds()).toEqual({ feeds: 0, renamed: 0, rewritten: 0 });
    await storage().writeNote("one", "later", "md", "x", {}, 5);
    expect(await storage().migrationPending()).toBe(false);
  });

  run("the feed's title image follows its note", async () => {
    const img = oldId(AT - 1), other = oldId(AT);
    await put("one", img, "png", PNG);
    await put("one", other, "md", "x");
    await storage().writeSettings("one", { title: "T", description: "D", image: `${img}.png`, showSender: false });
    await put("two", other, "md", "a title image that is no note of the feed");
    await storage().writeSettings("two", { title: "", description: "", image: `${img}.png`, showSender: true });
    expect(await migrateNoteIds()).toEqual({ feeds: 2, renamed: 3, rewritten: 0 });
    expect(await getSettings("one")).toEqual({ title: "T", description: "D", image: `${migratedId("one", img)}.png`, showSender: false });
    expect((await storage().readSettings("two")).image).toBe(`${img}.png`); // not one of its notes: left as written
  });

  run("a run stopped halfway finishes", async () => {
    const imgs = [oldId(AT - 3), oldId(AT - 2), oldId(AT - 1)];
    const txt = oldId(AT);
    for (const id of imgs) await put("one", id, "png", PNG);
    await put("one", txt, "md", imgs.map((id) => `![](${id}.png)`).join("\n"));
    // The first run got as far as two of the pictures and the text, before it rewrote the text.
    for (const id of [imgs[0], imgs[1]]) expect(await storage().renameNote("one", id, "png", migratedId("one", id))).toBe(true);
    expect(await storage().renameNote("one", txt, "md", migratedId("one", txt))).toBe(true);
    expect(await migrateNoteIds()).toEqual({ feeds: 1, renamed: 1, rewritten: 1 });
    expect((await refs("one")).map((r) => r.id).sort()).toEqual([...imgs, txt].map((id) => migratedId("one", id)).sort());
    expect(await text("one", migratedId("one", txt))).toBe(imgs.map((id) => `![](${migratedId("one", id)}.png)`).join("\n"));
  });

  run("two runs at once end as one would", async () => {
    const imgs = Array.from({ length: 6 }, (_, i) => oldId(AT - 10 + i));
    const txt = oldId(AT);
    for (const id of imgs) await put("one", id, "png", PNG);
    await put("one", txt, "md", imgs.map((id) => `![](${id}.png)`).join("\n"));
    const [a, b] = await Promise.all([migrateNoteIds(), migrateNoteIds()]);
    expect(a.renamed + b.renamed).toBeGreaterThanOrEqual(7);
    expect((await refs("one")).map((r) => r.id).sort()).toEqual([...imgs, txt].map((id) => migratedId("one", id)).sort());
    expect(await text("one", migratedId("one", txt))).toBe(imgs.map((id) => `![](${migratedId("one", id)}.png)`).join("\n"));
    for (const id of imgs) expect((await storage().readMeta("one", { id: migratedId("one", id), ext: "png" }))?.of).toBe(migratedId("one", txt));
  });

  run("a note that cannot move stays; references to the others follow all the same, and the log counts it", async () => {
    const stuck = oldId(AT - 2), img = oldId(AT - 1), txt = oldId(AT);
    await put("one", stuck, "png", PNG);
    await put("one", img, "png", PNG);
    await put("one", txt, "md", `![](${stuck}.png) ![](${img}.png)`);
    const rename = storage().renameNote.bind(storage());
    vi.spyOn(storage(), "renameNote").mockImplementation((feed, id, ext, newId) => (id === stuck ? Promise.resolve(false) : rename(feed, id, ext, newId)));
    let counts;
    const logs = await logsOf(async () => (counts = await migrateNoteIds()));
    expect(counts).toEqual({ feeds: 1, renamed: 2, rewritten: 1 });
    expect(await text("one", migratedId("one", txt))).toBe(`![](${stuck}.png) ![](${migratedId("one", img)}.png)`);
    expect(logs).toContainEqual(expect.objectContaining({ level: "warn", stuck: 1, unreadable: 0 }));
    expect(JSON.stringify(logs)).not.toContain(stuck);
    expect(await storage().migrationPending()).toBe(true); // not marked: the next start tries again
    vi.restoreAllMocks();
    expect(await migrateNoteIds()).toEqual({ feeds: 1, renamed: 1, rewritten: 1 });
    expect(await text("one", migratedId("one", txt))).toBe(`![](${migratedId("one", stuck)}.png) ![](${migratedId("one", img)}.png)`);
    expect(await storage().migrationPending()).toBe(false);
  });

  run("hand-placed ids stay", async () => {
    await put("one", "notes", "md", "by hand");
    expect(await migrateNoteIds()).toEqual({ feeds: 0, renamed: 0, rewritten: 0 });
    const [ref] = await refs("one");
    expect(ref.id).toBe("notes");
    expect(ref.date).toBeGreaterThan(Date.UTC(2026, 0, 1)); // when it was written, not 1970
  });

  run("the log has counts, never a feed's name or a note's id", async () => {
    const id = oldId(AT);
    await put("secret-feed", id, "md", "x");
    const logs = await logsOf(() => migrateNoteIds());
    expect(logs).toEqual([expect.objectContaining({ feeds: 1, renamed: 1, rewritten: 0 })]);
    const all = JSON.stringify(logs);
    for (const s of ["secret-feed", id, migratedId("secret-feed", id)]) expect(all).not.toContain(s);
  });
});

test("a rename cut short after its new sidecar, before its link, is finished", async () => {
  const id = oldId(AT);
  await put("one", id, "md", "half moved", { title: "T" });
  await writeFile(join(dir, "one", `.${migratedId("one", id)}.md.json`), "{}");
  expect(await migrateNoteIds()).toEqual({ feeds: 1, renamed: 1, rewritten: 0 });
  expect(await refs("one")).toEqual([{ id: migratedId("one", id), ext: "md", date: AT, draft: false }]);
  expect(await storage().readNote("one", migratedId("one", id), ["md"], () => true)).toMatchObject({ meta: { title: "T" } });
});

test("a note left under both ids by a rename cut short goes once, under its new id", async () => {
  const id = oldId(AT);
  await put("one", id, "md", "twice");
  // The file system's rename links the new name, then removes the old: a crash in between leaves both.
  const now = migratedId("one", id);
  expect(await storage().renameNote("one", id, "md", now)).toBe(true);
  await writeFile(join(dir, "one", `${id}.md`), "twice");
  expect((await refs("one")).length).toBe(2);
  expect(await migrateNoteIds()).toEqual({ feeds: 1, renamed: 1, rewritten: 0 });
  expect((await refs("one")).map((r) => r.id)).toEqual([now]);
});

test("a note placed by hand gets its date stored: a later write does not move it", async () => {
  await ensureFeed("one");
  await put("one", oldId(AT), "md", "x"); // something to migrate
  await writeFile(join(dir, "one", "notes.md"), "by hand");
  const at = new Date(Date.UTC(2025, 5, 1));
  await utimes(join(dir, "one", "notes.md"), at, at);
  await migrateNoteIds();
  expect((await refs("one")).find((r) => r.id === "notes")?.date).toBe(at.getTime());
  expect(await storage().replaceNote("one", "notes", ["md"], "edited")).toBe(true);
  expect((await refs("one")).find((r) => r.id === "notes")?.date).toBe(at.getTime());
});

// As on notefeed.me: an encrypted database, images in an S3 store, notes from 0.27 (old ids, dated 0).
(supported ? test : test.skip)("an encrypted database with images in a store: everything moves, and the next start does nothing", async () => {
  const { startFakeS3 } = await import("./storage/images/fake-s3");
  const s3 = await startFakeS3("access-a", ["images"]);
  try {
    vi.stubEnv("NOTEFEED_STORAGE", "sqlite");
    vi.stubEnv("NOTEFEED_ENCRYPTION_KEY", "k".repeat(64));
    for (const [k, v] of Object.entries({ IMAGES: "s3", S3_ENDPOINT: s3.endpoint, S3_BUCKET: "images", S3_ACCESS_KEY: "access-a", S3_SECRET_KEY: "secret-a" })) vi.stubEnv(`NOTEFEED_${k}`, v);
    resetStorageForTests();
    const [a, b, title, txt] = [oldId(AT - 2), oldId(AT - 1), oldId(AT - 600_000), oldId(AT)];
    const bytes = (n: number) => Buffer.concat([PNG, Buffer.from([n])]);
    await put("one", a, "png", bytes(1), { alt: "A" });
    await put("one", b, "jpg", bytes(2));
    await put("one", title, "png", bytes(3));
    await put("one", txt, "md", `# Two\n\n![A](${a}.png)\n![](${b}.jpg)`, { title: "Two" });
    await storage().writeSettings("one", { title: "Feed", description: "", image: `${title}.png`, showSender: true });
    const before = new Set(s3.objects.keys());
    expect(before.size).toBe(3);
    expect(await storage().migrationPending()).toBe(true);

    expect(await migrateNoteIds()).toEqual({ feeds: 1, renamed: 4, rewritten: 1 });

    const id = (old: string) => migratedId("one", old);
    expect((await refs("one")).map((r) => [r.id, r.date])).toEqual([[id(txt), AT], [id(b), AT - 1], [id(a), AT - 2], [id(title), AT - 600_000]]);
    expect(await text("one", id(txt))).toBe(`# Two\n\n![A](${id(a)}.png)\n![](${id(b)}.jpg)`);
    expect((await storage().readNote("one", id(txt), ["md"], () => false))?.meta).toEqual({ title: "Two" });
    expect(await storage().readFile("one", `${id(a)}.png`)).toEqual(bytes(1));
    expect(await storage().readFile("one", `${id(b)}.jpg`)).toEqual(bytes(2));
    expect(await storage().readFile("one", `${id(title)}.png`)).toEqual(bytes(3));
    expect(await storage().readFile("one", `${a}.png`)).toBeNull();
    expect(await storage().readMeta("one", { id: id(a), ext: "png" })).toEqual({ alt: "A", of: id(txt) });
    expect((await storage().readMeta("one", { id: id(b), ext: "jpg" }))?.of).toBe(id(txt));
    expect((await storage().readMeta("one", { id: id(title), ext: "png" }))?.of).toBeUndefined();
    expect((await getSettings("one")).image).toBe(`${id(title)}.png`);
    const after = new Set(s3.objects.keys());
    expect(after.size).toBe(3);
    for (const k of before) expect(after.has(k)).toBe(false); // the old objects are gone
    expect(await storage().migrationPending()).toBe(false);

    // The next start: a new process on the same database and store.
    await (storage() as unknown as { close(): Promise<void> }).close();
    resetStorageForTests();
    const requests = s3.requests.length;
    const reads = vi.spyOn(storage(), "listFeeds");
    expect(await migrateNoteIds()).toEqual({ feeds: 0, renamed: 0, rewritten: 0 });
    expect(reads).not.toHaveBeenCalled();
    expect(s3.requests.length).toBe(requests);
    expect(new Set(s3.objects.keys())).toEqual(after);
    await (storage() as unknown as { close(): Promise<void> }).close();
  } finally {
    resetStorageForTests();
    await s3.close();
  }
});
