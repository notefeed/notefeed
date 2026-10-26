import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ensureFeed, resetFeedsForTests } from "./feeds";
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
    expect(await refs("one")).toEqual([{ id: migratedId("one", id), ext: "md", date: Date.UTC(2026, 3, 1, 12, 0, 0) }]);
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

  run("a second run changes nothing", async () => {
    const img = oldId(AT - 1), txt = oldId(AT);
    await put("one", img, "png", PNG);
    await put("one", txt, "md", `![](${img}.png)`);
    await migrateNoteIds();
    const before = await refs("one");
    const body = await text("one", migratedId("one", txt));
    expect(await migrateNoteIds()).toEqual({ feeds: 0, renamed: 0, rewritten: 0 });
    expect(await refs("one")).toEqual(before);
    expect(await text("one", migratedId("one", txt))).toBe(body);
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

test("a note left under both ids by a rename cut short goes once, under its new id", async () => {
  const id = oldId(AT);
  await put("one", id, "md", "twice");
  await migrateNoteIds();
  // The file system's rename links the new name, then removes the old: a crash in between leaves both.
  const now = migratedId("one", id);
  await writeFile(join(dir, "one", `${id}.md`), "twice");
  expect((await refs("one")).length).toBe(2);
  expect(await migrateNoteIds()).toEqual({ feeds: 1, renamed: 1, rewritten: 0 });
  expect((await refs("one")).map((r) => r.id)).toEqual([now]);
});
