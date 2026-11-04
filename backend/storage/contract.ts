// The tests every Storage backend must pass. A backend's test file calls describeStorage() with a factory for a fresh, empty store.
import { describe, expect, test } from "vitest";
import { NotFoundError, ReadIdTakenError, RemovedFeedError } from "../errors";
import { FeedGoneError, type Storage } from "./types";

export type Harness = {
  storage: Storage;
  cleanup(): Promise<void>;
};

const MD = ["md"];
const makeFeed = async (s: Storage, name: string, readId = `rid-${name}`) => void (await s.createFeed(name, readId));
const ALL = ["md", "png"];
const text = (b: Buffer | undefined) => b?.toString("utf8");

export function describeStorage(name: string, make: () => Promise<Harness>): void {
  describe(`storage contract: ${name}`, () => {
    // Each test gets a fresh store; a test body receives the harness.
    const t = (title: string, body: (h: Harness) => Promise<void>) =>
      test(title, async () => {
        const h = await make();
        try {
          await makeFeed(h.storage, "f");
          await body(h);
        } finally {
          await h.cleanup();
        }
      });

    describe("notes", () => {
      t("writeNote returns the id and readNote gives the note back byte for byte", async ({ storage: s }) => {
        const id = await s.writeNote("f", "a", "md", "# T\r\nx", { sender: "Ann", tags: ["ci"] }, 0);
        expect(id).toBe("a");
        const n = await s.readNote("f", id, MD, () => true);
        expect(text(n?.content)).toBe("# T\r\nx");
        expect(n?.ext).toBe("md");
        expect(n?.meta).toEqual({ sender: "Ann", tags: ["ci"] });
        expect(n?.mtime).toBeInstanceOf(Date);
      });
      t("a note without metadata reads as {}", async ({ storage: s }) => {
        const id = await s.writeNote("f", "a", "md", "x", {}, 0);
        expect((await s.readNote("f", id, MD, () => true))?.meta).toEqual({});
      });
      t("a taken id gets -2, -3 and never overwrites", async ({ storage: s }) => {
        expect(await s.writeNote("f", "a", "md", "one", {}, 0)).toBe("a");
        expect(await s.writeNote("f", "a", "md", "two", { sender: "S" }, 0)).toBe("a-2");
        expect(await s.writeNote("f", "a", "md", "three", {}, 0)).toBe("a-3");
        expect(text((await s.readNote("f", "a", MD, () => true))?.content)).toBe("one");
      });
      t("concurrent writes with one base get different ids and lose nothing", async ({ storage: s }) => {
        const ids = await Promise.all([1, 2, 3, 4, 5].map((i) => s.writeNote("f", "a", "md", `n${i}`, {}, 0)));
        expect(new Set(ids).size).toBe(5);
        const bodies = await Promise.all(ids.map(async (id) => text((await s.readNote("f", id, MD, () => true))?.content)));
        expect(bodies.sort()).toEqual(["n1", "n2", "n3", "n4", "n5"]);
      });
      t("binary content that is not UTF-8 and holds NUL bytes round-trips", async ({ storage: s }) => {
        const bytes = new Uint8Array([0x89, 0, 0xff, 0xfe, 0, 0x50]);
        const id = await s.writeNote("f", "a", "png", bytes, {}, 0);
        expect([...((await s.readNote("f", id, ALL, () => true))?.content ?? [])]).toEqual([...bytes]);
        expect([...((await s.readFile("f", `${id}.png`)) ?? [])]).toEqual([...bytes]);
      });
      t("withContent false gives the size and empty content", async ({ storage: s }) => {
        const id = await s.writeNote("f", "a", "png", new Uint8Array(1000), {}, 0);
        const full = await s.readNote("f", id, ALL, () => true);
        expect([full?.size, full?.content.length]).toEqual([1000, 1000]);
        const lean = await s.readNote("f", id, ALL, () => false);
        expect([lean?.size, lean?.content.length]).toEqual([1000, 0]);
        expect((await s.readNote("f", id, ALL, (ext) => ext === "md"))?.content.length).toBe(0);
      });
      t("readNote only finds the accepted extensions, and a missing note is null", async ({ storage: s }) => {
        const id = await s.writeNote("f", "a", "png", new Uint8Array([1]), {}, 0);
        expect(await s.readNote("f", id, MD, () => true)).toBeNull();
        expect(await s.readNote("f", "nope", ALL, () => true)).toBeNull();
        expect(await s.readNote("missing", "a", ALL, () => true)).toBeNull();
      });
      t("listNoteRefs lists every note once, and a missing feed as empty", async ({ storage: s }) => {
        await s.writeNote("f", "a", "md", "x", { sender: "S" }, 0);
        await s.writeNote("f", "b", "png", new Uint8Array([1]), {}, 0);
        const refs = (await s.listNoteRefs("f")).sort((x, y) => x.id.localeCompare(y.id));
        expect(refs).toEqual([{ id: "a", ext: "md", date: 0, draft: false }, { id: "b", ext: "png", date: 0, draft: false }]);
        expect(await s.listNoteRefs("missing")).toEqual([]);
      });
      t("readMeta reads only the metadata", async ({ storage: s }) => {
        await s.writeNote("f", "a", "md", "x", { title: "T", tags: ["a"] }, 0);
        expect(await s.readMeta("f", { id: "a", ext: "md" })).toEqual({ title: "T", tags: ["a"] });
        expect(await s.readMeta("f", { id: "nope", ext: "md" })).toBeNull();
      });
      t("replaceNote changes the content, keeps the metadata, and is false for a missing note", async ({ storage: s }) => {
        const id = await s.writeNote("f", "a", "md", "old", { sender: "S" }, 0);
        expect(await s.replaceNote("f", id, MD, "new")).toBe(true);
        const n = await s.readNote("f", id, MD, () => true);
        expect([text(n?.content), n?.meta]).toEqual(["new", { sender: "S" }]);
        expect(await s.replaceNote("f", "nope", MD, "x")).toBe(false);
        expect(await s.listNoteRefs("f")).toEqual([{ id, ext: "md", date: 0, draft: false }]);
      });
      t("updateMeta sets, removes with null, and is false for a missing note", async ({ storage: s }) => {
        const id = await s.writeNote("f", "a", "md", "x", { sender: "S", title: "T" }, 0);
        expect(await s.updateMeta("f", id, MD, { title: "U", sender: null })).toBe(true);
        expect((await s.readNote("f", id, MD, () => true))?.meta).toEqual({ title: "U" });
        expect(await s.updateMeta("f", id, MD, { title: "" })).toBe(true);
        expect((await s.readNote("f", id, MD, () => true))?.meta).toEqual({});
        expect(await s.updateMeta("f", "nope", MD, { title: "x" })).toBe(false);
      });
      t("deleteNote removes the note, a second delete is false", async ({ storage: s }) => {
        const id = await s.writeNote("f", "a", "md", "x", { sender: "S" }, 0);
        expect(await s.deleteNote("f", id, MD)).toBe(true);
        expect(await s.listNoteRefs("f")).toEqual([]);
        expect(await s.readMeta("f", { id, ext: "md" })).toBeNull();
        expect(await s.deleteNote("f", id, MD)).toBe(false);
      });
      t("readFile gives a note's bytes by name, and null for any other name", async ({ storage: s }) => {
        const id = await s.writeNote("f", "a", "md", "hello", {}, 0);
        expect(text((await s.readFile("f", `${id}.md`)) ?? undefined)).toBe("hello");
        for (const n of ["nope.md", ".readid", "../x.md", "a", "a.b.md", ""]) expect(await s.readFile("f", n)).toBeNull();
      });
      t("writeNote stores the date and readNote and listNoteRefs give it back", async ({ storage: s }) => {
        await s.writeNote("f", "a", "md", "x", { of: "t" }, 1000);
        const n = await s.readNote("f", "a", MD, () => true);
        expect([n?.date, n?.meta]).toEqual([1000, { of: "t" }]);
        expect(await s.listNoteRefs("f")).toEqual([{ id: "a", ext: "md", date: 1000, draft: false }]);
      });
      // a=1000, b=3000, c=2000, d=2000
      const dated = async (s: Storage) => {
        for (const [id, date] of [["a", 1000], ["b", 3000], ["c", 2000], ["d", 2000]] as const) await s.writeNote("f", id, "md", id, {}, date);
      };
      const ids = async (s: Storage, q?: Parameters<Storage["listNoteRefs"]>[1]) => (await s.listNoteRefs("f", q)).map((r) => r.id);
      t("listNoteRefs is newest first, ties by id descending", async ({ storage: s }) => {
        await dated(s);
        expect(await ids(s)).toEqual(["b", "d", "c", "a"]);
      });
      t("upTo leaves out later notes", async ({ storage: s }) => {
        await dated(s);
        expect(await ids(s, { upTo: 2000 })).toEqual(["d", "c", "a"]);
      });
      t("before and limit page", async ({ storage: s }) => {
        await dated(s);
        expect(await ids(s, { before: "d", limit: 2 })).toEqual(["c", "a"]);
        expect(await ids(s, { before: "zz" })).toEqual([]);
        expect(await ids(s, { upTo: 2000, before: "b" })).toEqual([]);
      });
      t("setDate moves a note in the order", async ({ storage: s }) => {
        await dated(s);
        expect(await s.setDate("f", "a", MD, 4000)).toBe(true);
        expect(await s.listNoteRefs("f", { limit: 1 })).toEqual([{ id: "a", ext: "md", date: 4000, draft: false }]);
        expect((await s.readNote("f", "a", MD, () => true))?.date).toBe(4000);
        expect(await s.setDate("f", "nope", MD, 4000)).toBe(false);
      });
      t("setDate keeps the metadata, and updateMeta keeps the date", async ({ storage: s }) => {
        await s.writeNote("f", "a", "md", "x", { title: "T" }, 5);
        expect(await s.setDate("f", "a", MD, 6)).toBe(true);
        expect(await s.updateMeta("f", "a", MD, { title: null })).toBe(true);
        const n = await s.readNote("f", "a", MD, () => true);
        expect([n?.meta, n?.date]).toEqual([{}, 6]);
      });
      // Drafts (#265): a plaintext flag beside the date; listed only when asked for, so a reader's listing that forgets it stays safe.
      const drafted = async (s: Storage) => {
        await s.writeNote("f", "a", "md", "a", {}, 1000);
        await s.writeNote("f", "b", "md", "b", {}, 2000, true);
        await s.writeNote("f", "c", "md", "c", {}, 3000);
      };
      t("drafts are left out unless asked for", async ({ storage: s }) => {
        await drafted(s);
        expect(await ids(s)).toEqual(["c", "a"]);
        expect(await ids(s, { drafts: true })).toEqual(["c", "b", "a"]);
        expect((await s.listNoteRefs("f", { drafts: true })).map((r) => r.draft)).toEqual([false, true, false]);
        expect(await ids(s, { drafts: true, upTo: 2000, limit: 1 })).toEqual(["b"]);
      });
      t("before at a left-out draft gives none", async ({ storage: s }) => {
        await drafted(s);
        expect(await ids(s, { before: "b" })).toEqual([]);
        expect(await ids(s, { before: "b", drafts: true })).toEqual(["a"]);
      });
      t("setDraft flips the flag and keeps date and metadata", async ({ storage: s }) => {
        await s.writeNote("f", "a", "md", "x", { title: "T" }, 5);
        expect(await s.setDraft("f", "a", MD, true)).toBe(true);
        let n = await s.readNote("f", "a", MD, () => true);
        expect([n?.draft, n?.date, n?.meta]).toEqual([true, 5, { title: "T" }]);
        expect(await ids(s)).toEqual([]);
        expect(await s.setDraft("f", "a", MD, false)).toBe(true);
        n = await s.readNote("f", "a", MD, () => true);
        expect([n?.draft, n?.date, n?.meta]).toEqual([false, 5, { title: "T" }]);
        expect(await s.setDraft("f", "nope", MD, true)).toBe(false);
      });
      t("updateMeta, setDate and renameNote keep the draft flag", async ({ storage: s }) => {
        await s.writeNote("f", "a", "md", "x", { title: "T" }, 5, true);
        expect(await s.updateMeta("f", "a", MD, { title: "U" })).toBe(true);
        expect(await s.setDate("f", "a", MD, 6)).toBe(true);
        expect(await s.renameNote("f", "a", "md", "z")).toBe(true);
        const n = await s.readNote("f", "z", MD, () => true);
        expect([n?.draft, n?.date, n?.meta]).toEqual([true, 6, { title: "U" }]);
      });
      t("a note written without the flag is published", async ({ storage: s }) => {
        await s.writeNote("f", "a", "md", "x", {}, 5);
        expect((await s.readNote("f", "a", MD, () => true))?.draft).toBe(false);
        expect(await ids(s)).toEqual(["a"]);
      });
      t("renameNote keeps content, metadata and date", async ({ storage: s }) => {
        await s.writeNote("f", "a", "md", "text", { title: "T" }, 5);
        expect(await s.renameNote("f", "a", "md", "z")).toBe(true);
        expect(await s.readNote("f", "a", MD, () => true)).toBeNull();
        const n = await s.readNote("f", "z", MD, () => true);
        expect([text(n?.content), n?.meta, n?.date, n?.size]).toEqual(["text", { title: "T" }, 5, 4]);
        expect(await s.listNoteRefs("f")).toEqual([{ id: "z", ext: "md", date: 5, draft: false }]);
        expect(await s.renameNote("f", "nope", "md", "y")).toBe(false);
      });
      t("renameNote onto a taken id is false and both notes stay", async ({ storage: s }) => {
        await s.writeNote("f", "a", "md", "one", { title: "A" }, 1);
        await s.writeNote("f", "b", "png", new Uint8Array([1, 2]), { alt: "B" }, 2);
        expect(await s.renameNote("f", "a", "md", "b")).toBe(false);
        const [a, b] = await Promise.all(["a", "b"].map((id) => s.readNote("f", id, ALL, () => true)));
        expect([text(a?.content), a?.meta, a?.date]).toEqual(["one", { title: "A" }, 1]);
        expect([[...(b?.content ?? [])], b?.meta, b?.date]).toEqual([[1, 2], { alt: "B" }, 2]);
      });
      t("renameNote of an image keeps its bytes, and readFile finds them under the new name", async ({ storage: s }) => {
        const bytes = new Uint8Array([0x89, 0x50, 0, 7]);
        await s.writeNote("f", "p", "png", bytes, { alt: "x" }, 9);
        expect(await s.renameNote("f", "p", "png", "q")).toBe(true);
        expect(await s.readFile("f", "p.png")).toBeNull();
        expect([...((await s.readFile("f", "q.png")) ?? [])]).toEqual([...bytes]);
        expect((await s.readNote("f", "q", ALL, () => false))?.meta).toEqual({ alt: "x" });
      });
      t("migrationPending: true once notes are stored, until markMigrated, which holds for good", async ({ storage: s }) => {
        expect(await s.migrationPending()).toBe(false); // no notes: nothing to move
        await s.writeNote("f", "notes", "md", "hand-placed", {}, 5);
        expect(await s.migrationPending()).toBe(true);
        await s.markMigrated();
        await s.markMigrated(); // twice is fine
        expect(await s.migrationPending()).toBe(false);
        await s.writeNote("f", "20260401T120000Z-0196e8f0-1c2d-7abc-8def-0123456789ab-2", "png", new Uint8Array([1]), {}, 5);
        expect(await s.migrationPending()).toBe(false);
      });
      t("writeNote to a feed deleted meanwhile throws FeedGoneError", async (h) => {
        await h.storage.deleteFeed("f");
        await expect(h.storage.writeNote("f", "a", "md", "x", {}, 0)).rejects.toBeInstanceOf(FeedGoneError);
      });
    });

    describe("the feed's own values", () => {
      t("settings: a missing value is the default, a write round-trips", async ({ storage: s }) => {
        expect(await s.readSettings("f")).toEqual({ title: "", description: "", image: "", showSender: true });
        const set = { title: "T", description: "D", image: "a.png", showSender: false };
        await s.writeSettings("f", set);
        expect(await s.readSettings("f")).toEqual(set);
        const own = { ...set, ownImage: true }; // the feed's own title image (#310)
        await s.writeSettings("f", own);
        expect(await s.readSettings("f")).toEqual(own);
      });
      t("the password hash: none, write, read, remove", async ({ storage: s }) => {
        expect(await s.readHash("f")).toBeNull();
        await s.writeHash("f", "h1");
        expect(await s.readHash("f")).toBe("h1");
        await s.writeHash("f", "h2");
        expect(await s.readHash("f")).toBe("h2");
        await s.removeHash("f");
        expect(await s.readHash("f")).toBeNull();
      });
      t("writing settings or a hash to a deleted feed throws FeedGoneError", async (h) => {
        await h.storage.deleteFeed("f");
        await expect(h.storage.writeSettings("f", { title: "", description: "", image: "", showSender: true })).rejects.toBeInstanceOf(FeedGoneError);
        await expect(h.storage.writeHash("f", "x")).rejects.toBeInstanceOf(FeedGoneError);
      });
    });

    describe("feeds", () => {
      t("createFeed makes a feed with its read id, once", async ({ storage: s }) => {
        expect(await s.createFeed("g", "gid-123")).toEqual({ created: true });
        expect(await s.feedReadId("g")).toBe("gid-123");
        expect(await s.createFeed("g", "other-id")).toEqual({ created: false });
        expect(await s.feedReadId("g")).toBe("gid-123");
        expect(await s.feedForReadId("other-id")).toBeNull();
      });
      t("feedReadId is undefined for a missing feed, feedForReadId null for an unknown id", async ({ storage: s }) => {
        expect(await s.feedReadId("nope")).toBeUndefined();
        expect(await s.feedForReadId("nope-id")).toBeNull();
      });
      t("two creations of one name at once: exactly one is created", async ({ storage: s }) => {
        const r = await Promise.all([s.createFeed("g", "id-one"), s.createFeed("g", "id-two"), s.createFeed("g", "id-three")]);
        expect(r.filter((x) => x.created)).toHaveLength(1);
        expect(await s.feedCount()).toBe(2); // f and g
      });
      t("two feeds asking for one read id at once: one wins, the other is ReadIdTakenError", async ({ storage: s }) => {
        const r = await Promise.allSettled([s.createFeed("g", "same-id"), s.createFeed("h", "same-id")]);
        expect(r.filter((x) => x.status === "fulfilled" && x.value.created)).toHaveLength(1);
        const lost = r.find((x) => x.status === "rejected");
        expect(lost && "reason" in lost && lost.reason).toBeInstanceOf(ReadIdTakenError);
        expect(await s.feedCount()).toBe(2);
      });
      t("a taken read id is ReadIdTakenError and creates nothing", async ({ storage: s }) => {
        await expect(s.createFeed("g", "rid-f")).rejects.toBeInstanceOf(ReadIdTakenError);
        expect(await s.feedReadId("g")).toBeUndefined();
      });
      t("createFeed with a hash is protected from the start", async ({ storage: s }) => {
        await s.createFeed("g", "gid-123", "the-hash");
        expect(await s.readHash("g")).toBe("the-hash");
      });
      t("setReadId changes it and frees the old one", async ({ storage: s }) => {
        await s.setReadId("f", "new-id-1");
        expect(await s.feedReadId("f")).toBe("new-id-1");
        expect(await s.feedForReadId("new-id-1")).toBe("f");
        expect(await s.feedForReadId("rid-f")).toBeNull();
        await s.createFeed("g", "rid-f"); // the old id is free again
      });
      t("setReadId: a taken id is ReadIdTakenError, a missing feed is NotFoundError", async ({ storage: s }) => {
        await s.createFeed("g", "gid-123");
        await expect(s.setReadId("f", "gid-123")).rejects.toBeInstanceOf(ReadIdTakenError);
        expect(await s.feedReadId("f")).toBe("rid-f");
        await expect(s.setReadId("nope", "whatever-1")).rejects.toBeInstanceOf(NotFoundError);
      });
      t("deleteFeed removes the notes, the hash and the settings, and frees the read id", async ({ storage: s }) => {
        await s.writeNote("f", "a", "md", "x", {}, 0);
        await s.writeHash("f", "h");
        await s.writeSettings("f", { title: "T", description: "", image: "", showSender: true });
        expect(await s.deleteFeed("f")).toBe(true);
        expect(await s.feedReadId("f")).toBeUndefined();
        expect(await s.listNoteRefs("f")).toEqual([]);
        expect(await s.readHash("f")).toBeNull();
        expect((await s.readSettings("f")).title).toBe("");
        expect(await s.deleteFeed("f")).toBe(false);
        await s.createFeed("g", "rid-f");
        await s.createFeed("f", "fresh-id-9"); // the same name again is a new, empty feed
        expect(await s.listNoteRefs("f")).toEqual([]);
        expect(await s.readHash("f")).toBeNull();
      });
      t("listFeeds, listFeedNames and feedCount agree", async ({ storage: s }) => {
        await s.createFeed("g", "gid-123");
        expect((await s.listFeeds()).sort()).toEqual(["f", "g"]);
        expect((await s.listFeedNames()).sort()).toEqual(["f", "g"]);
        expect(await s.feedCount()).toBe(2);
      });
      t("usage counts every feed's notes and bytes per extension, and nothing that names a feed", async ({ storage: s }) => {
        const before = Date.now() - 1000;
        await s.createFeed("g", "gid-123", "hash");
        await s.writeNote("f", "a", "md", "hello", {}, 0);
        await s.writeNote("f", "b", "md", "hi", { title: "T" }, 0);
        await s.writeNote("f", "c", "png", new Uint8Array(10), {}, 0);
        await s.deleteNote("f", "b", MD);
        const usage = await s.usage();
        expect(JSON.stringify(usage)).not.toMatch(/"f"|"g"|rid-f|gid-123/);
        const [g, f] = [...usage].sort((a, b) => Number(a.lastWrite !== null) - Number(b.lastWrite !== null));
        expect(g).toEqual({ protected: true, readLink: true, lastWrite: null, notes: {} });
        expect(f).toMatchObject({ protected: false, readLink: true, notes: { md: { count: 1, bytes: 5 }, png: { count: 1, bytes: 10 } } });
        expect(f.lastWrite).toBeGreaterThanOrEqual(before);
        expect(f.lastWrite).toBeLessThanOrEqual(Date.now() + 1000);
      });
      t("usage of a store with no feed but the harness's is that feed alone, empty", async ({ storage: s }) => {
        expect(await s.usage()).toEqual([{ protected: false, readLink: true, lastWrite: null, notes: {} }]);
      });
      t("a feed name and a read id of 64 characters work", async ({ storage: s }) => {
        const name = "n".repeat(64);
        const id = "r".repeat(64);
        await s.createFeed(name, id);
        expect(await s.feedForReadId(id)).toBe(name);
        await s.writeNote(name, "a", "md", "x", {}, 0);
        expect(await s.listNoteRefs(name)).toEqual([{ id: "a", ext: "md", date: 0, draft: false }]);
      });
      t("takedown (#155): the tombstone keeps the name and the read id out of use, the content goes, the blocklist holds", async ({ storage: s }) => {
        await s.writeNote("f", "a", "md", "x", {}, 0);
        await s.writeNote("f", "p", "png", new Uint8Array([0x89, 0x50, 1]), {}, 0);
        expect(await s.isRemoved({ feed: "f" })).toBe(false);
        const gone = await s.takedownFeed("f", "rid-f");
        expect(gone.removed).toBe(true);
        expect(await s.feedReadId("f")).toBeUndefined();
        expect(await s.feedForReadId("rid-f")).toBeNull();
        expect(await s.listNoteRefs("f")).toEqual([]);
        expect(await s.readFile("f", "p.png")).toBeNull();
        expect(await s.isRemoved({ feed: "f" })).toBe(true);
        expect(await s.isRemoved({ readId: "rid-f" })).toBe(true);
        expect(await s.isRemoved({ feed: "g", readId: "rid-g" })).toBe(false);
        await expect(s.createFeed("f", "fresh-id-1")).rejects.toBeInstanceOf(RemovedFeedError);
        await expect(s.createFeed("g", "rid-f")).rejects.toBeInstanceOf(ReadIdTakenError);
        await s.createFeed("g", "rid-g");
        await expect(s.setReadId("g", "rid-f")).rejects.toBeInstanceOf(ReadIdTakenError);
        expect(await s.feedCount()).toBe(1);
        expect(await s.listFeeds()).toEqual(["g"]);
        // Again, and for a feed that never was: a tombstone all the same, and no error.
        expect((await s.takedownFeed("f", "rid-f")).removed).toBe(false);
        expect((await s.takedownFeed("never", "rid-never")).removed).toBe(false);
        expect(await s.isRemoved({ readId: "rid-never" })).toBe(true);
        const h = "a".repeat(64);
        expect(await s.isBlockedImage(h)).toBe(false);
        await s.blockImages([h, "b".repeat(64)]);
        await s.blockImages([h]); // twice is fine
        await s.blockImages([]);
        expect(await s.isBlockedImage(h)).toBe(true);
        expect(await s.isBlockedImage("b".repeat(64))).toBe(true);
        expect(await s.isBlockedImage("c".repeat(64))).toBe(false);
      });
      t("note takedown (#159): tombstones first, the post goes, the mark stays deletable", async ({ storage: s }) => {
        await s.writeNote("f", "t", "md", "x", {}, 10);
        await s.writeNote("f", "p", "png", new Uint8Array([0x89, 0x50, 1]), { of: "t" }, 9);
        await s.writeNote("f", "k", "md", "keep", {}, 11);
        await s.takedownNotes("f", [{ id: "t", ext: "md" }, { id: "p", ext: "png" }], { date: 10, draft: false }, "t");
        expect(await s.removedNote("f", "t")).toEqual({ date: 10, draft: false });
        expect(await s.removedNote("f", "p")).toEqual({ date: 10, draft: false });
        expect(await s.removedNote("f", "k")).toBeNull();
        expect((await s.listNoteRefs("f")).map((r) => `${r.id}.${r.ext}`)).toEqual(["k.md", "t.removed"]);
        expect(await s.readFile("f", "p.png")).toBeNull();
        expect(await s.deleteNote("f", "t", ["removed"])).toBe(true);
        expect(await s.removedNote("f", "t")).toEqual({ date: 10, draft: false }); // the tombstone outlives the mark
        await s.takedownNotes("f", [], { date: 0, draft: false }, null); // a repeat writes nothing
        expect((await s.listNoteRefs("f")).map((r) => r.id)).toEqual(["k"]);
      });
      t("a draft's mark is a draft (#159)", async ({ storage: s }) => {
        await s.writeNote("f", "d", "md", "x", {}, 5, true);
        await s.takedownNotes("f", [{ id: "d", ext: "md" }], { date: 5, draft: true }, "d");
        expect(await s.removedNote("f", "d")).toEqual({ date: 5, draft: true });
        await s.takedownNotes("f", [{ id: "d", ext: "md" }], { date: 9, draft: false }, null);
        expect(await s.removedNote("f", "d")).toEqual({ date: 5, draft: true }); // the first record holds
        expect(await s.listNoteRefs("f")).toEqual([]);
        expect(await s.listNoteRefs("f", { drafts: true })).toEqual([{ id: "d", ext: "removed", date: 5, draft: true }]);
      });
      t("note tombstones go with the feed (#159)", async ({ storage: s }) => {
        await s.writeNote("f", "t", "md", "x", {}, 0);
        await s.takedownNotes("f", [{ id: "t", ext: "md" }], { date: 0, draft: false }, null);
        await s.deleteFeed("f");
        await s.createFeed("f", "rid-f2");
        expect(await s.removedNote("f", "t")).toBeNull();
      });
      t("forgetFeed never removes a feed that is still there under another id", async ({ storage: s }) => {
        await s.writeNote("f", "a", "md", "x", {}, 0);
        await s.forgetFeed("f", "not-its-id");
        expect(await s.feedReadId("f")).toBe("rid-f");
        expect(await s.listNoteRefs("f")).toEqual([{ id: "a", ext: "md", date: 0, draft: false }]);
      });
    });
  });
}
