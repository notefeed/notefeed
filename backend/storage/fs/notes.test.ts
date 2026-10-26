import { mkdir, mkdtemp, readdir, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { deleteNote, listNoteRefs, readNote, renameNote, replaceNote, setDate, updateMeta, writeNote } from "./notes";

const EXTS = ["md", "png"];
const all = () => true;

let dir: string;
beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), "notefeed-"));
  process.env.DATA_DIR = root;
  dir = join(root, "f");
  await mkdir(dir);
});
const files = async () => (await readdir(dir)).sort();

describe("writeNote", () => {
  test("stores the content byte for byte, with no front matter", async () => {
    const id = await writeNote("f", "a", "md", "# T\r\nx", { sender: "Ann" }, 0);
    expect(await readFile(join(dir, `${id}.md`), "utf8")).toBe("# T\r\nx");
  });
  test("writes the metadata and the date as .<id>.<ext>.json", async () => {
    const id = await writeNote("f", "a", "md", "x", { sender: "Ann", tags: ["ci"] }, 1000);
    expect(JSON.parse(await readFile(join(dir, `.${id}.md.json`), "utf8"))).toEqual({ sender: "Ann", tags: ["ci"], date: 1000 });
  });
  test("writes a sidecar with the date alone for empty metadata", async () => {
    const id = await writeNote("f", "a", "md", "x", {}, 7);
    expect(await files()).toEqual([`.${id}.md.json`, `${id}.md`]);
    expect(JSON.parse(await readFile(join(dir, `.${id}.md.json`), "utf8"))).toEqual({ date: 7 });
  });
  test("a taken id gets -2, -3 and never overwrites", async () => {
    await writeFile(join(dir, "a.md"), "hand");
    expect(await writeNote("f", "a", "md", "x", { sender: "S" }, 0)).toBe("a-2");
    expect(await writeNote("f", "a", "md", "y", {}, 0)).toBe("a-3");
    expect(await readFile(join(dir, "a.md"), "utf8")).toBe("hand");
  });
  test("stores binary content", async () => {
    const id = await writeNote("f", "a", "png", new Uint8Array([0x89, 1, 2]), {}, 0);
    expect([...(await readFile(join(dir, `${id}.png`)))]).toEqual([0x89, 1, 2]);
  });
});

describe("readNote and listNoteRefs", () => {
  test("reads content, meta and mtime", async () => {
    const id = await writeNote("f", "a", "md", "x", { title: "T" }, 0);
    const n = await readNote("f", id, EXTS, all);
    expect(n?.ext).toBe("md");
    expect(n?.content.toString()).toBe("x");
    expect(n?.meta).toEqual({ title: "T" });
    expect(n?.mtime).toBeInstanceOf(Date);
  });
  test("a sidecar with invalid JSON reads as empty meta", async () => {
    await writeFile(join(dir, "h.md"), "x");
    await writeFile(join(dir, ".h.md.json"), "{nope");
    expect((await readNote("f", "h", EXTS, all))?.meta).toEqual({});
  });
  test("fields of the wrong type are dropped", async () => {
    await writeFile(join(dir, "h.md"), "x");
    await writeFile(join(dir, ".h.md.json"), JSON.stringify({ title: 5, sender: "S", tags: ["a", 1] }));
    expect((await readNote("f", "h", EXTS, all))?.meta).toEqual({ sender: "S", tags: ["a"] });
  });
  test("a note from before dates were stored: the date is the metadata's created, else the mtime", async () => {
    await writeFile(join(dir, "c.md"), "x");
    await writeFile(join(dir, ".c.md.json"), JSON.stringify({ created: "2026-01-02T03:04:05Z", date: "not a number" }));
    await writeFile(join(dir, "m.md"), "x");
    await utimes(join(dir, "m.md"), 1, 1);
    expect((await readNote("f", "c", EXTS, all))?.date).toBe(Date.parse("2026-01-02T03:04:05Z"));
    expect((await readNote("f", "m", EXTS, all))?.date).toBe(1000);
    expect(await listNoteRefs("f")).toEqual([{ id: "c", ext: "md", date: Date.parse("2026-01-02T03:04:05Z") }, { id: "m", ext: "md", date: 1000 }]);
  });
  test("a feed of more notes than are read at once lists every one, in order", async () => {
    for (let i = 0; i < 130; i++) await writeNote("f", `n${i}`, "md", "x", {}, i);
    const refs = await listNoteRefs("f");
    expect(refs.map((r) => r.date)).toEqual([...Array(130).keys()].reverse());
  });
  test("updateMeta and setDate keep a sidecar that holds only the date", async () => {
    await writeNote("f", "a", "md", "x", { title: "T" }, 5);
    expect(await updateMeta("f", "a", EXTS, { title: null })).toBe(true);
    expect(JSON.parse(await readFile(join(dir, ".a.md.json"), "utf8"))).toEqual({ date: 5 });
    expect(await setDate("f", "a", EXTS, 6)).toBe(true);
    expect(JSON.parse(await readFile(join(dir, ".a.md.json"), "utf8"))).toEqual({ date: 6 });
  });
  test("renameNote moves the content file and the sidecar", async () => {
    await writeNote("f", "a", "md", "x", { title: "T" }, 5);
    expect(await renameNote("f", "a", "md", "z")).toBe(true);
    expect(await files()).toEqual([".z.md.json", "z.md"]);
  });
  test("renameNote onto an id whose sidecar is left over is false", async () => {
    await writeNote("f", "a", "md", "x", {}, 5);
    await writeFile(join(dir, ".z.md.json"), "{}");
    expect(await renameNote("f", "a", "md", "z")).toBe(false);
    expect(await files()).toEqual([".a.md.json", ".z.md.json", "a.md"]);
  });
  test("a note without a sidecar has empty meta", async () => {
    await writeFile(join(dir, "h.md"), "x");
    expect((await readNote("f", "h", EXTS, all))?.meta).toEqual({});
  });
  test("a sidecar without content is not listed and not a note", async () => {
    await writeFile(join(dir, ".o.md.json"), "{}");
    expect(await listNoteRefs("f")).toEqual([]);
    expect(await readNote("f", "o", EXTS, all)).toBeNull();
  });
  test("dot files and names with several dots are never listed", async () => {
    await writeFile(join(dir, ".readid"), "x");
    await writeFile(join(dir, ".t.tmp"), "x");
    await writeFile(join(dir, "a.b.md"), "x");
    await writeFile(join(dir, "ok.md"), "x");
    expect((await listNoteRefs("f")).map((r) => r.id)).toEqual(["ok"]);
  });
  test("a missing note and a missing feed read as null / empty", async () => {
    expect(await readNote("f", "nope", EXTS, all)).toBeNull();
    expect(await listNoteRefs("missing")).toEqual([]);
  });
});

describe("replaceNote and deleteNoteFile", () => {
  test("replace changes the content and leaves the sidecar", async () => {
    const id = await writeNote("f", "a", "md", "old", { sender: "S" }, 0);
    expect(await replaceNote("f", id, EXTS, "new")).toBe(true);
    const n = await readNote("f", id, EXTS, all);
    expect(n?.content.toString()).toBe("new");
    expect(n?.meta).toEqual({ sender: "S" });
  });
  test("replace of a missing note is false and creates nothing", async () => {
    expect(await replaceNote("f", "nope", EXTS, "x")).toBe(false);
    expect(await files()).toEqual([]);
  });
  test("delete removes content and sidecar", async () => {
    const id = await writeNote("f", "a", "md", "x", { sender: "S" }, 0);
    expect(await deleteNote("f", id, EXTS)).toBe(true);
    expect(await files()).toEqual([]);
    expect(await deleteNote("f", id, EXTS)).toBe(false);
  });
});

describe("readNote and the size of a note", () => {
  test("gives the size from the file system and reads the bytes only when asked", async () => {
    const id = await writeNote("f", "a", "png", new Uint8Array(1000), {}, 0);
    const full = await readNote("f", id, EXTS, all);
    expect([full?.size, full?.content.length]).toEqual([1000, 1000]);
    const lean = await readNote("f", id, EXTS, () => false);
    expect([lean?.size, lean?.content.length]).toEqual([1000, 0]);
    expect((await readNote("f", id, EXTS, (ext) => ext === "md"))?.content.length).toBe(0);
  });
});
