// The operator's takedown (#155) on the file system backend, end to end through the HTTP handlers: what a removed feed answers
// under both identifiers, and that its images are refused everywhere afterwards. The SQL backends run the same storage contract
// (backend/storage/contract.ts) and the route test in http/operator.test.ts.
import { appendFile, mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test, vi, afterEach } from "vitest";
import { changeDate, changeDraft, changeMeta, createNote, replaceContent } from "./notes";
import { isRemovedReadNote } from "./index";
import { CipherError } from "./storage/cipher";
import { FeedGoneError } from "./storage/types";
import { feedForReadId, hasFeed, isRemovedFeed, readIdOf, resetFeedsForTests } from "./feeds";
import { resetRateLimitsForTests } from "./limits";
import { logsOf } from "./log";
import { API_PREFIX, dispatch } from "./http/api";
import { fileRoute } from "./http/files";
import { takedownRoute } from "./http/operator";
import { rssRoute } from "./http/rss";
import { imageHash, noteOfTarget, readIdOfTarget } from "./takedown";
import { processImage } from "./imageprocess";
import { storage } from "./storage";
import { png } from "./testimages";

const TOKEN = "operator-token-".padEnd(40, "x");
const BASE = "http://localhost:3000";
const PNG = png(1);
const PNG2 = png(2);
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "notefeed-takedown-"));
  vi.stubEnv("DATA_DIR", root);
  vi.stubEnv("NOTEFEED_SECRET", "test-secret-".padEnd(32, "x"));
  vi.stubEnv("NOTEFEED_OPERATOR_TOKEN", TOKEN);
  vi.stubEnv("NOTEFEED_RATE_LIMIT", "0");
  resetFeedsForTests();
  resetRateLimitsForTests();
});
afterEach(() => vi.unstubAllEnvs());

async function call(method: string, path: string, init: { body?: BodyInit; headers?: Record<string, string> } = {}) {
  const url = new URL(API_PREFIX + path, BASE);
  const segments = url.pathname.slice(API_PREFIX.length + 1).split("/").map(decodeURIComponent);
  return dispatch(new Request(url, { method, body: init.body, headers: { host: "localhost:3000", ...init.headers } }), segments);
}
const upload = (feed: string, body: Uint8Array, headers: Record<string, string> = {}) => call("POST", `/feeds/${feed}/notes`, { body: body as BodyInit, headers: { "content-type": "image/png", ...headers } });
const takedown = (target: unknown, authorization = `Bearer ${TOKEN}`, extra: Record<string, unknown> = {}) =>
  takedownRoute(new Request(`${BASE}/api/operator/takedown`, { method: "POST", body: JSON.stringify({ target, ...extra }), headers: { "content-type": "application/json", authorization } }));
const takedownNote = (target: string) => takedown(target, `Bearer ${TOKEN}`, { scope: "note" });

test("readIdOfTarget: a read link, a note's read URL, an image URL, a bare id; anything else is null", () => {
  expect(readIdOfTarget("https://notes.example.com/r/abc-123/20260101T000000Z-x.png")).toBe("abc-123");
  expect(readIdOfTarget("https://notes.example.com/r/abc-123/feed.xml")).toBe("abc-123");
  expect(readIdOfTarget("https://notes.example.com/r/abc-123")).toBe("abc-123");
  expect(readIdOfTarget("/r/abc-123/")).toBe("abc-123");
  expect(readIdOfTarget(" abc-123 ")).toBe("abc-123");
  for (const bad of ["", "https://notes.example.com/myfeed", "https://notes.example.com/r/", "not a url", "/r/a b"]) expect(readIdOfTarget(bad), bad).toBeNull();
});

describe("a feed taken down by its image URL", () => {
  test("answers removed under its read id and its name, its content is gone, and its image is refused everywhere", async () => {
    expect((await call("POST", "/feeds/bad/notes", { body: "# text", headers: { "content-type": "text/markdown", "x-read-id": "removed-feed-id" } })).status).toBe(201);
    const pic = await (await upload("bad", PNG)).json();
    const rid = (await readIdOf("bad"))!;
    expect(rid).toBe("removed-feed-id");
    let res!: Response;
    const lines = await logsOf(async () => void (res = await takedown(pic.file_url)), "info");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: true, already_removed: false, notes: 2, images: 1, blocked: 1, image_keys: [] });
    const line = lines.find((l) => l.msg === "feed removed by the operator");
    expect(line).toMatchObject({ notes: 2, images: 1, blocked: 1 });
    expect(JSON.stringify(lines)).not.toContain('"bad"');

    expect(await hasFeed("bad")).toBe(false);
    expect(await isRemovedFeed("bad")).toBe(true);
    expect(await feedForReadId(rid)).toBeNull();
    expect((await rssRoute(new Request(`${BASE}/r/${rid}/feed.xml`), rid)).status).toBe(410);
    expect((await fileRoute(rid, pic.file)).status).toBe(410);
    // The read API says so too (#159): a client can tell a removed feed from a read id nobody has.
    for (const path of [`/read/${rid}`, `/read/${rid}/notes`, `/read/${rid}/notes/${pic.id}`]) {
      const read = await call("GET", path);
      expect(read.status).toBe(410);
      expect(await read.json()).toEqual({ error: "this feed was removed by the operator", code: "removed" });
    }
    expect((await call("GET", `/read/${"A".repeat(22)}/notes`)).status).toBe(200);
    expect((await readdir(root)).filter((n) => !n.startsWith("."))).toEqual([]);
    expect((await readFile(join(root, ".tombstones"), "utf8")).trim()).toMatch(/^\{"feed":"bad","readId":"/);

    // The name is out of use: a post, a text or a picture, is 410; so is the read id for a new feed.
    const text = await call("POST", "/feeds/bad/notes", { body: "# again", headers: { "content-type": "text/markdown" } });
    expect(text.status).toBe(410);
    expect(await text.json()).toEqual({ error: "this feed was removed by the operator", code: "removed" });
    expect(await hasFeed("bad")).toBe(false);
    const taken = await call("POST", "/feeds/other/notes", { body: "# x", headers: { "content-type": "text/markdown", "x-read-id": rid } });
    expect(taken.status).toBe(409);
    expect((await taken.json()).code).toBe("taken");

    // The image is blocked in any feed, however it comes; another picture is fine.
    await createNote("elsewhere", "# ok");
    const blocked = await upload("elsewhere", PNG);
    expect(blocked.status).toBe(451);
    expect(await blocked.json()).toEqual({ error: "this image may not be posted here", code: "blocked" });
    const form = new FormData();
    form.append("text", "# with ![](a.png)");
    form.append("file", new File([PNG as BlobPart], "a.png", { type: "image/png" }));
    expect((await call("POST", "/feeds/elsewhere/notes", { body: form })).status).toBe(451);
    const fine = await (await upload("elsewhere", PNG2)).json();
    expect((await call("PUT", `/feeds/elsewhere/notes/${fine.id}`, { body: PNG as BodyInit, headers: { "content-type": "image/png" } })).status).toBe(451);
    expect((await call("GET", "/feeds/elsewhere/notes")).status).toBe(200);
    expect((await (await call("GET", "/feeds/elsewhere/notes")).json()).notes).toHaveLength(2);
  });

  test("a read id nobody has is 404, one removed before is already_removed, a bad body 400, the gate as elsewhere", async () => {
    await createNote("bad", "# text");
    const rid = (await readIdOf("bad"))!;
    expect((await takedown("https://x.test/r/nobody-has-this")).status).toBe(404);
    expect((await takedown(rid)).status).toBe(200);
    const again = await takedown(`/r/${rid}/feed.xml`);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ removed: false, already_removed: true });
    expect((await takedown("https://x.test/feedname")).status).toBe(400);
    expect((await takedown(42)).status).toBe(400);
    expect((await takedown(rid, "Bearer wrong")).status).toBe(401);
    vi.stubEnv("NOTEFEED_OPERATOR_TOKEN", "");
    expect((await takedown(rid)).status).toBe(404);
  });

  test("an image is refused when the blocklist holds it as sent or as stored (ADR 0049)", async () => {
    await createNote("elsewhere", "# ok");
    // As sent: an entry made from an original, as every entry was before images were processed. As stored: one made from a stored file.
    await storage().blockImages([imageHash(PNG)]);
    expect((await upload("elsewhere", PNG)).status).toBe(451);
    await storage().blockImages([imageHash(await processImage(PNG2, "png"))]);
    expect((await upload("elsewhere", PNG2)).status).toBe(451);
    expect((await upload("elsewhere", png(3))).status).toBe(201);
  });

  test("the tombstones and the blocklist survive a restart, and a folder that came back is removed again", async () => {
    await createNote("bad", "# text");
    await upload("bad", PNG);
    await takedown((await readIdOf("bad"))!);
    await createNote("good", "# stays");
    resetFeedsForTests(); // as a restart: the index is read from disk again
    expect(await isRemovedFeed("bad")).toBe(true);
    expect(await hasFeed("good")).toBe(true);
    expect((await upload("good", PNG)).status).toBe(451);
    // A restore by hand brings the folder back: not a feed, and gone at the next start.
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(root, "bad"));
    await writeFile(join(root, "bad", ".readid"), "some-id-xyz");
    resetFeedsForTests();
    expect(await hasFeed("bad")).toBe(false);
    expect((await readdir(root)).filter((n) => !n.startsWith("."))).toEqual(["good"]);
  });
});

// The takedown of one post (#159): a text note and its attachments, or an image posted alone.
describe("a post taken down", () => {
  // A text with two attachments, and a note that stays. The ids by kind, from the owner's list.
  async function postWithTwo(feed = "good", headers: Record<string, string> = {}) {
    expect((await call("POST", `/feeds/${feed}/notes`, { body: "# stays", headers: { "content-type": "text/markdown" } })).status).toBe(201);
    const form = new FormData();
    form.append("text", "# bad ![](a.png) ![](b.png)");
    form.append("file", new File([PNG as BlobPart], "a.png", { type: "image/png" }));
    form.append("file", new File([PNG2 as BlobPart], "b.png", { type: "image/png" }));
    expect((await call("POST", `/feeds/${feed}/notes`, { body: form, headers })).status).toBe(201);
    const notes: { id: string; type: string; file: string; title: string }[] = (await (await call("GET", `/feeds/${feed}/notes`)).json()).notes;
    const text = notes.find((n) => n.type === "text/markdown" && n.title !== "stays")!;
    const images = notes.filter((n) => n.type === "image/png");
    const kept = notes.find((n) => n.title === "stays")!;
    return { rid: (await readIdOf(feed))!, text, images, kept };
  }
  const readList = async (rid: string) => (await (await call("GET", `/read/${rid}/notes`)).json()).notes as { id: string; date: string; removed?: true; type: string; file_url: string | null }[];

  test("by the text's read URL: the post goes, its images are blocklisted, a mark is in its place", async () => {
    const { rid, text, images, kept } = await postWithTwo();
    let res!: Response;
    const lines = await logsOf(async () => void (res = await takedownNote(`https://notes.example.com/r/${rid}/${text.id}`)), "info");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ removed: true, already_removed: false, blocked: 2, image_keys: [] });
    expect([...body.notes].sort()).toEqual([text.id, ...images.map((i) => i.id)].sort());
    expect(JSON.stringify(body)).not.toContain('"good"');
    expect(lines.find((l) => l.msg === "post removed by the operator")).toMatchObject({ notes: 3, blocked: 2 });
    expect(JSON.stringify(lines)).not.toContain('"good"');

    const list = await readList(rid);
    expect(list.map((n) => n.id).sort()).toEqual([text.id, kept.id].sort());
    const mark = list.find((n) => n.id === text.id)!;
    expect(mark).toMatchObject({ removed: true, type: "application/x-notefeed-removed", file_url: null });
    expect(list.find((n) => n.id === kept.id)?.removed).toBeUndefined();
    await createNote("elsewhere", "# ok");
    expect((await upload("elsewhere", PNG)).status).toBe(451);
    expect((await upload("elsewhere", PNG2)).status).toBe(451);
  });

  test("naming an attachment by its image URL removes the text it was posted with", async () => {
    const { rid, text, images } = await postWithTwo();
    const res = await takedownNote(`/r/${rid}/${images[0].file}`);
    expect(res.status).toBe(200);
    expect((await res.json()).notes).toHaveLength(3);
    expect((await readList(rid)).filter((n) => n.removed).map((n) => n.id)).toEqual([text.id]);
  });

  test("an image URL by name names the newest note of that name", async () => {
    const pic = await (await upload("good", PNG, { "x-note-name": "logo.png" })).json();
    const rid = (await readIdOf("good"))!;
    const res = await takedownNote(`https://notes.example.com/r/${rid}/logo.png`);
    expect(res.status).toBe(200);
    expect((await res.json()).notes).toEqual([pic.id]);
    expect((await readList(rid)).map((n) => [n.id, n.removed])).toEqual([[pic.id, true]]);
  });

  test("an attachment whose text the owner deleted is a post of one", async () => {
    const { rid, text, images } = await postWithTwo();
    expect((await call("DELETE", `/feeds/good/notes/${text.id}`)).status).toBe(204);
    const res = await takedownNote(`${rid}/${images[1].id}`);
    expect((await res.json()).notes).toEqual([images[1].id]);
    expect((await readList(rid)).filter((n) => n.removed).map((n) => n.id)).toEqual([images[1].id]);
  });

  test("again, and after the mark is deleted: already removed, and no mark comes back", async () => {
    const { rid, text } = await postWithTwo();
    await takedownNote(`/r/${rid}/${text.id}`);
    const again = await takedownNote(`/r/${rid}/${text.id}`);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ removed: false, already_removed: true, notes: [], blocked: 0, image_keys: [] });
    expect((await call("DELETE", `/feeds/good/notes/${text.id}`)).status).toBe(204);
    expect(await (await takedownNote(`/r/${rid}/${text.id}`)).json()).toMatchObject({ already_removed: true });
    expect((await readList(rid)).some((n) => n.removed)).toBe(false);
  });

  test("again by its image URL: already removed, for a lone image and for an attachment", async () => {
    const { rid, images } = await postWithTwo();
    const pic = await (await upload("good", png(3))).json();
    for (const file of [pic.file, images[0].file]) {
      expect((await takedownNote(`/r/${rid}/${file}`)).status, file).toBe(200);
      const again = await takedownNote(`/r/${rid}/${file}`);
      expect(again.status, file).toBe(200);
      expect(await again.json(), file).toMatchObject({ already_removed: true });
    }
  });

  test("a takedown cut short after its tombstones is finished by the next one", async () => {
    const { rid, text, images } = await postWithTwo();
    // What a crash between the tombstones and the deletions leaves: the ids recorded, the notes still there.
    await appendFile(join(root, "good", ".removed-notes"), [text.id, ...images.map((i) => i.id)].map((id) => `${id}\n`).join(""));
    const res = await takedownNote(`/r/${rid}/${text.id}`);
    expect(await res.json()).toMatchObject({ removed: true, already_removed: false, blocked: 2 });
    const list = await readList(rid);
    expect(list.filter((n) => n.removed).map((n) => n.id)).toEqual([text.id]);
    expect(list.some((n) => images.some((i) => i.id === n.id))).toBe(false);
    await createNote("elsewhere", "# ok");
    expect((await upload("elsewhere", PNG)).status).toBe(451);
  });

  test("a draft post leaves a draft mark: readers see nothing at its place, the owner sees the mark", async () => {
    const { rid, text } = await postWithTwo("good", { "x-note-draft": "true" });
    await takedownNote(`/r/${rid}/${text.id}`);
    expect((await readList(rid)).some((n) => n.removed)).toBe(false);
    const rss = await (await rssRoute(new Request(`${BASE}/r/${rid}/feed.xml`), rid)).text();
    expect(rss).not.toContain("Removed by the operator");
    const own = (await (await call("GET", "/feeds/good/notes")).json()).notes;
    expect(own.find((n: { id: string }) => n.id === text.id)).toMatchObject({ removed: true, draft: true });
  });

  test("a draft image is named by the name it was posted with too", async () => {
    const pic = await (await upload("good", PNG, { "x-note-name": "draft.png", "x-note-draft": "true" })).json();
    const res = await takedownNote(`/r/${(await readIdOf("good"))!}/draft.png`);
    expect(res.status).toBe(200);
    expect((await res.json()).notes).toEqual([pic.id]);
  });

  test("a hidden post's removal stays hidden from readers: its id is a missing one to them while its mark is a draft", async () => {
    const { rid, text, images } = await postWithTwo("good", { "x-note-draft": "true" });
    await takedownNote(`/r/${rid}/${text.id}`);
    expect((await call("GET", `/read/${rid}/notes/${text.id}`)).status).toBe(404);
    expect((await fileRoute(rid, images[0].file)).status).toBe(404);
    expect(await isRemovedReadNote(rid, text.id)).toBe(false);
    expect((await call("GET", `/feeds/good/notes/${text.id}`)).status).toBe(410); // the owner is told
  });

  test("an edit never reaches a mark, so one that raced the takedown changes nothing", async () => {
    const { rid, text } = await postWithTwo();
    await takedownNote(`/r/${rid}/${text.id}`);
    expect(await changeMeta("good", text.id, { title: "back" })).toBeNull();
    expect(await replaceContent("good", text.id, new TextEncoder().encode("# back"), "text/markdown").catch(() => null)).toBeNull(); // refused or not found
    expect(await changeDate("good", text.id, new Date(0))).toBeNull();
    expect(await changeDraft("good", text.id, true)).toBeNull();
    expect((await readList(rid)).find((n) => n.id === text.id)).toMatchObject({ removed: true, date: expect.any(String) });
    expect((await readList(rid)).find((n) => n.id === text.id)?.date).not.toBe(new Date(0).toISOString());
  });

  test("a damaged note is taken down by its id, with the attachments posted with it", async () => {
    const { rid, text, images } = await postWithTwo();
    const s = storage();
    const [readNote, readMeta, readFile] = [s.readNote.bind(s), s.readMeta.bind(s), s.readFile.bind(s)];
    vi.spyOn(s, "readNote").mockImplementation(async (f, id, ...rest) => (id === text.id ? Promise.reject(new CipherError()) : readNote(f, id, ...rest)));
    vi.spyOn(s, "readMeta").mockImplementation(async (f, ref) => (ref.id === text.id ? Promise.reject(new CipherError()) : readMeta(f, ref)));
    vi.spyOn(s, "readFile").mockImplementation(async (f, name) => (name.startsWith(text.id) ? Promise.reject(new CipherError()) : readFile(f, name)));
    const res = await takedownNote(`/r/${rid}/${text.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect([...body.notes].sort()).toEqual([text.id, ...images.map((i) => i.id)].sort());
    expect(body.blocked).toBe(2);
    vi.restoreAllMocks();
    expect((await readList(rid)).filter((n) => n.removed).map((n) => n.id)).toEqual([text.id]);
  });

  test("a feed deleted while it is taken down is 404, not a failure", async () => {
    const { rid, text } = await postWithTwo();
    vi.spyOn(storage(), "takedownNotes").mockRejectedValueOnce(new FeedGoneError());
    const res = await takedownNote(`/r/${rid}/${text.id}`);
    expect(res.status).toBe(404);
    vi.restoreAllMocks();
  });

  test("a note nobody has is 404; a target that names no note is 400; an unknown scope is 400", async () => {
    const { rid } = await postWithTwo();
    expect((await takedownNote(`/r/${rid}/${"Z".repeat(22)}`)).status).toBe(404);
    expect((await takedownNote(`/r/${rid}`)).status).toBe(400);
    expect((await takedownNote(rid)).status).toBe(400);
    expect((await takedown(rid, `Bearer ${TOKEN}`, { scope: "bogus" })).status).toBe(400);
    expect((await takedownNote(`/r/${rid}/x`)).status).toBe(404);
  });
});

test("noteOfTarget: a note's read URL, an image URL, <read id>/<note>; a feed's link or a bare id is null", () => {
  expect(noteOfTarget("https://notes.example.com/r/abc-123/n0te-id")).toEqual({ readId: "abc-123", note: "n0te-id" });
  expect(noteOfTarget("/r/abc-123/pic.png")).toEqual({ readId: "abc-123", note: "pic.png" });
  expect(noteOfTarget(" abc-123/n0te-id ")).toEqual({ readId: "abc-123", note: "n0te-id" });
  expect(noteOfTarget("https://notes.example.com/r/abc-123/my%20logo.png")).toEqual({ readId: "abc-123", note: "my logo.png" });
  expect(noteOfTarget("https://notes.example.com/r/abc-123/n0te-id/")).toEqual({ readId: "abc-123", note: "n0te-id" });
  for (const bad of ["", "abc-123", "https://notes.example.com/r/abc-123", "/r/abc-123/", "/r/abc-123/feed.xml", "/r/abc-123/a/b", "not a url"]) expect(noteOfTarget(bad), bad).toBeNull();
});

test("a removed note answers 410 everywhere, with its mark and after the mark is deleted (#159)", async () => {
  expect((await call("POST", "/feeds/good/notes", { body: "# bad", headers: { "content-type": "text/markdown" } })).status).toBe(201);
  const pic = await (await upload("good", PNG)).json();
  const text = (await (await call("GET", "/feeds/good/notes")).json()).notes.find((n: { type: string }) => n.type === "text/markdown");
  const rid = (await readIdOf("good"))!;
  await takedown(`/r/${rid}/${text.id}`, `Bearer ${TOKEN}`, { scope: "note" });
  await takedown(`/r/${rid}/${pic.file}`, `Bearer ${TOKEN}`, { scope: "note" });
  const gone = async (res: Response | Promise<Response>, what: string) => {
    const r = await res;
    expect(r.status, what).toBe(410);
    expect(await r.json(), what).toEqual({ error: "this note was removed by the operator", code: "removed" });
  };
  const everywhere = async () => {
    await gone(call("GET", `/feeds/good/notes/${text.id}`), "owner's GET");
    await gone(call("GET", `/read/${rid}/notes/${text.id}`), "read API");
    await gone(call("GET", `/read/${rid}/notes/${pic.id}`), "read API, image");
    const file = await fileRoute(rid, pic.file);
    expect(file.status).toBe(410);
    expect(await file.text()).toBe("removed by the operator");
  };
  await everywhere();
  await gone(call("PUT", `/feeds/good/notes/${text.id}`, { body: "# back", headers: { "content-type": "text/markdown" } }), "PUT content");
  for (const patch of [{ title: "x" }, { date: "2020-01-01" }, { draft: false }, { tags: ["t"] }]) await gone(call("PATCH", `/feeds/good/notes/${text.id}`, { body: JSON.stringify(patch), headers: { "content-type": "application/json" } }), JSON.stringify(patch));
  const form = new FormData();
  form.append("text", "# back ![](a.png)");
  form.append("file", new File([PNG2 as BlobPart], "a.png", { type: "image/png" }));
  await gone(call("PUT", `/feeds/good/notes/${text.id}`, { body: form }), "PUT with pictures");
  const marks = (await (await call("GET", "/feeds/good/notes")).json()).notes.filter((n: { removed?: true }) => n.removed);
  expect(marks.map((n: { id: string; title: string }) => [n.id, n.title]).sort()).toEqual([[pic.id, ""], [text.id, ""]].sort());
  expect((await call("DELETE", `/feeds/good/notes/${text.id}`)).status).toBe(204);
  expect((await call("DELETE", `/feeds/good/notes/${pic.id}`)).status).toBe(204);
  await everywhere();
  await gone(call("PATCH", `/feeds/good/notes/${text.id}`, { body: JSON.stringify({ title: "x" }), headers: { "content-type": "application/json" } }), "PATCH after the mark");
});
