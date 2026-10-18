// A note whose stored copy can't be decrypted (issue #212): never a broken feed, never a plain error. The pages, the API and MCP list
// it as a damaged note in its place; RSS leaves it out; reading it alone is the `unreadable` refusal; the operator gets a log line and
// a counter. The storage is made to fail for one note, so these run on the file system backend.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { UnreadableNoteError } from "./errors";
import { readIdOf, resetFeedsForTests } from "./feeds";
import { dispatch } from "./http/api";
import { fileRoute } from "./http/files";
import { rssRoute } from "./http/rss";
import { getFeed, getFeedNote, getReadFeed, getReadNote } from "./index";
import { logsOf } from "./log";
import { mcpRoute } from "./mcp";
import { renderMetrics, resetMetricsForTest } from "./metrics";
import { createImageNote, createNote, getNote, listNotes } from "./notes";
import { CipherError } from "./storage/cipher";
import { resetStorageForTests, storage } from "./storage";

const BASE = "http://localhost:3000";
beforeEach(async () => {
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "notefeed-unreadable-"));
  process.env.NOTEFEED_SECRET = "test-secret-".padEnd(32, "x");
  process.env.NOTEFEED_METRICS = "1";
  for (const k of ["NOTEFEED_PASSWORD", "PUBLIC_URL"]) delete process.env[k];
  resetStorageForTests();
  resetFeedsForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.NOTEFEED_METRICS;
  resetMetricsForTest();
});

// Two notes; the newer one's stored copy does not decrypt.
async function damaged() {
  const { note: good } = await createNote("test", "# Good note", new Date("2026-09-29T10:00:00Z"), undefined, ["t"]);
  const { note: bad } = await createNote("test", "# Secret text", new Date("2026-09-29T11:00:00Z"), undefined, ["t"]);
  const s = storage();
  const [readNote, readMeta, readFile] = [s.readNote.bind(s), s.readMeta.bind(s), s.readFile.bind(s)];
  vi.spyOn(s, "readNote").mockImplementation(async (f, id, ...rest) => (id === bad.id ? Promise.reject(new CipherError()) : readNote(f, id, ...rest)));
  vi.spyOn(s, "readMeta").mockImplementation(async (f, ref) => (ref.id === bad.id ? Promise.reject(new CipherError()) : readMeta(f, ref)));
  vi.spyOn(s, "readFile").mockImplementation(async (f, name) => (name.startsWith(bad.id) ? Promise.reject(new CipherError()) : readFile(f, name)));
  return { good, bad };
}

test("a list shows a damaged note in its place, or leaves it out when asked to", async () => {
  const { good, bad } = await damaged();
  const listed = await listNotes("test", 50, undefined, undefined, undefined, true);
  expect(listed.map((n) => [n.id, n.unreadable])).toEqual([
    [bad.id, true],
    [good.id, false],
  ]);
  const placeholder = listed[0];
  expect(placeholder.createdAt.toISOString()).toBe("2026-09-29T11:00:00.000Z");
  expect(placeholder.file).toBe(`${bad.id}.md`);
  expect([placeholder.title, placeholder.content, placeholder.tags]).toEqual(["", undefined, []]);
  expect((await listNotes("test")).map((n) => n.id)).toEqual([good.id]);
  // The tag filter can't read its tags: it is not a match, and the rest is still found.
  expect((await listNotes("test", 50, undefined, "t", undefined, true)).map((n) => n.id)).toEqual([good.id]);
});

test("reading a damaged note alone is the unreadable refusal, with a log line naming the note and a counter", async () => {
  const { bad } = await damaged();
  const logs = await logsOf(async () => {
    await expect(getNote("test", bad.id)).rejects.toThrow(UnreadableNoteError);
  });
  const line = logs.find((l) => l.msg === "a note could not be decrypted");
  expect(line).toMatchObject({ level: "error", note: bad.id });
  expect(JSON.stringify(logs)).not.toContain("Secret text");
  expect(JSON.stringify(logs)).not.toContain('"test"'); // never the feed's name
  expect((await renderMetrics()).body).toMatch(/^notefeed_notes_unreadable_total 1$/m);
});

test("the feed page and the read-only view show it as a placeholder; its own pages refuse it", async () => {
  const { good, bad } = await damaged();
  expect((await getFeed("test"))?.notes.map((n) => n.unreadable)).toEqual([true, false]);
  const rid = (await readIdOf("test"))!;
  expect((await getReadFeed(rid))?.notes.map((n) => n.id)).toEqual([bad.id, good.id]);
  await expect(getFeedNote("test", bad.id)).rejects.toThrow(UnreadableNoteError);
  await expect(getReadNote(rid, bad.id)).rejects.toThrow(UnreadableNoteError);
});

test("the API lists it marked unreadable and refuses it alone with the unreadable code", async () => {
  const { good, bad } = await damaged();
  const get = (path: string[]) => dispatch(new Request(`${BASE}/api/v1/${path.join("/")}`, { headers: { host: "localhost:3000" } }), path);
  const list = await get(["feeds", "test", "notes"]);
  expect(list.status).toBe(200);
  const { notes } = await list.json();
  expect(notes.map((n: { id: string; unreadable?: boolean }) => [n.id, n.unreadable])).toEqual([
    [bad.id, true],
    [good.id, undefined],
  ]);
  expect(notes[0]).toMatchObject({ title: "", tags: [], size: 0, type: "text/markdown", file: `${bad.id}.md` });
  expect(notes[0]).not.toHaveProperty("content");
  const one = await get(["feeds", "test", "notes", bad.id]);
  expect(one.status).toBe(500);
  expect(await one.json()).toEqual({ error: "the note's stored copy cannot be decrypted", code: "unreadable" });
});

test("MCP lists it marked unreadable and refuses it alone", async () => {
  const { bad } = await damaged();
  const call = async (name: string, args: Record<string, unknown>) => {
    const _meta = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "t", version: "0" }, "io.modelcontextprotocol/clientCapabilities": {} };
    const res = await mcpRoute(
      new Request(`${BASE}/mcp`, {
        method: "POST",
        headers: { host: "localhost:3000", "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/call", "mcp-name": name },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args, _meta } }),
      }),
    );
    return (await res.json()).result;
  };
  const listed = await call("list_notes", { feed: "test" });
  expect(listed.structuredContent.notes[0]).toMatchObject({ id: bad.id, unreadable: true });
  expect(listed.structuredContent.notes[1]).not.toHaveProperty("unreadable");
  const one = await call("get_note", { feed: "test", id: bad.id });
  expect(one.isError).toBe(true);
  expect(one.content[0].text).toContain("the note's stored copy cannot be decrypted");
});

test("RSS leaves it out and serves the rest", async () => {
  const { good } = await damaged();
  const rid = (await readIdOf("test"))!;
  const res = await rssRoute(new Request(`${BASE}/r/${rid}/feed.xml`, { headers: { host: "localhost:3000" } }), rid);
  expect(res.status).toBe(200);
  const xml = await res.text();
  expect(xml.match(/<item>/g)).toHaveLength(1);
  expect(xml).toContain(good.id);
});

test("a damaged note's file says so: a picture as a picture, any other file in words, never cached", async () => {
  const { bad } = await damaged();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  const { note: picture } = await createImageNote("test", png, {});
  const s = storage();
  const readFile = vi.mocked(s.readFile).getMockImplementation()!;
  vi.spyOn(s, "readFile").mockImplementation(async (f, name) => (name.startsWith(picture.id) ? Promise.reject(new CipherError()) : readFile(f, name)));
  const rid = (await readIdOf("test"))!;
  const image = await fileRoute(rid, picture.file);
  expect(image.status).toBe(500);
  expect(image.headers.get("content-type")).toBe("image/svg+xml");
  expect(image.headers.get("cache-control")).toBe("no-store");
  expect(await image.text()).toContain("This picture can't be shown");
  const text = await fileRoute(rid, `${bad.id}.md`);
  expect(text.status).toBe(500);
  expect(await text.text()).toBe("This note can't be shown: its stored copy can't be decrypted.");
});
