// A scheduled note (dated after now) answers readers exactly like a missing one, by every read route; its owner sees it, marked.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { resetFeedsForTests, readIdOf } from "../feeds";
import { saveSettings } from "../feedsettings";
import { resetRateLimitsForTests } from "../limits";
import { createImageNote, createNote, createNoteOf, encoder, MARKDOWN, newNoteId, type Note } from "../notes";
import { storage } from "../storage";
import { API_PREFIX, dispatch } from "./api";
import { fileRoute } from "./files";
import { rssRoute } from "./rss";

const BASE = "http://localhost:3000";
beforeEach(async () => {
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "notefeed-scheduled-"));
  process.env.NOTEFEED_SECRET = "test-secret-".padEnd(32, "x");
  resetFeedsForTests();
  resetRateLimitsForTests();
  for (const k of ["NOTEFEED_PASSWORD", "NOTEFEED_RATE_LIMIT", "PUBLIC_URL", "NOTEFEED_TITLE"]) delete process.env[k];
});

async function call(method: string, path: string) {
  const url = new URL(API_PREFIX + path, BASE);
  const segments = url.pathname.slice(API_PREFIX.length + 1).split("/").map(decodeURIComponent);
  return dispatch(new Request(url, { method, headers: { host: "localhost:3000" } }), segments);
}
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const HOUR = 3_600_000;

// V: visible, an hour ago. S: scheduled an hour from now, with one attachment (a picture it shows, dated just before it).
async function feedWithScheduled(feed = "later"): Promise<{ v: Note; s: Note; att: Note; rid: string }> {
  const now = Date.now();
  const v = (await createNote(feed, "# Visible", new Date(now - HOUR))).note;
  const sId = newNoteId();
  const att = (await createImageNote(feed, PNG, { of: sId }, new Date(now + HOUR - 1))).note;
  const s = (await createNoteOf(feed, MARKDOWN, "md", encoder.encode(`# Scheduled\n\n![](${att.file})`), { id: sId }, new Date(now + HOUR))).note;
  return { v, s, att, rid: (await readIdOf(feed))! };
}

describe("readers", () => {
  test("the read API lists only V; S is 404; before=S is an empty list", async () => {
    const { v, s, rid } = await feedWithScheduled();
    const list = await (await call("GET", `/read/${rid}/notes`)).json();
    expect(list.notes.map((n: { id: string }) => n.id)).toEqual([v.id]);
    const one = await call("GET", `/read/${rid}/notes/${s.id}`);
    expect(one.status).toBe(404);
    expect(await one.json()).toEqual(await (await call("GET", `/read/${rid}/notes/${"x".repeat(22)}`)).json()); // as a missing one
    expect(await (await call("GET", `/read/${rid}/notes?before=${s.id}`)).json()).toEqual({ notes: [], next: null });
    expect((await call("GET", `/read/${rid}/notes/${v.id}`)).status).toBe(200);
  });

  test("RSS has no item for S or its attachment", async () => {
    const { v, s, att, rid } = await feedWithScheduled();
    const xml = await (await rssRoute(new Request(`${BASE}/r/${rid}/feed.xml`), rid)).text();
    expect(xml).toContain(v.id);
    expect(xml).not.toContain(s.id);
    expect(xml).not.toContain(att.id);
    expect(xml.match(/<item>/g)).toHaveLength(1);
  });

  test("files: S's file and its attachment's are 404 as missing ones; V's is 200", async () => {
    const { v, s, att, rid } = await feedWithScheduled();
    expect((await fileRoute(rid, v.file)).status).toBe(200);
    for (const file of [s.file, att.file]) {
      const res = await fileRoute(rid, file);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe(await (await fileRoute(rid, `${"x".repeat(22)}.md`)).text());
    }
  });

  test("an attachment dated later than its visible note is 404 until its date", async () => {
    const now = Date.now();
    const v = (await createNote("later", "# Visible", new Date(now - HOUR))).note;
    const img = (await createImageNote("later", PNG, { of: v.id }, new Date(now - HOUR - 1))).note;
    const rid = (await readIdOf("later"))!;
    expect((await fileRoute(rid, img.file)).status).toBe(200);
    await storage().setDate("later", img.id, [img.ext], now + HOUR);
    expect((await fileRoute(rid, img.file)).status).toBe(404);
    expect((await fileRoute(rid, v.file)).status).toBe(200);
  });

  test("a title image that is a scheduled image note is none to readers until its date", async () => {
    const { v, rid } = await feedWithScheduled();
    const later = (await createImageNote("later", PNG, {}, new Date(Date.now() + HOUR))).note;
    await saveSettings("later", { title: "T", description: "", image: later.file, showSender: true });
    expect((await (await call("GET", `/read/${rid}`)).json()).image_url).toBeNull();
    const xml = await (await rssRoute(new Request(`${BASE}/r/${rid}/feed.xml`), rid)).text();
    expect(xml).not.toContain(later.file);
    // A visible one shows.
    const now = (await createImageNote("later", PNG, { of: v.id }, new Date(Date.now() - 2 * HOUR))).note;
    await saveSettings("later", { title: "T", description: "", image: now.file, showSender: true });
    expect((await (await call("GET", `/read/${rid}`)).json()).image_url).toBe(`${BASE}/r/${rid}/${now.file}`);
  });
});

describe("owners", () => {
  test("GET /feeds/{feed}/notes lists both, S with scheduled: true, V without", async () => {
    const { v, s, att } = await feedWithScheduled();
    const { notes } = await (await call("GET", "/feeds/later/notes")).json();
    expect(notes.map((n: { id: string }) => n.id)).toEqual([s.id, att.id, v.id]);
    expect(notes[0].scheduled).toBe(true);
    expect(notes[1].scheduled).toBe(true);
    expect(notes[2]).not.toHaveProperty("scheduled");
    expect(await (await call("GET", `/feeds/later/notes/${s.id}`)).json()).toMatchObject({ id: s.id, scheduled: true });
  });

  test("a feed whose only note is scheduled has its read link for the owner", async () => {
    await createNote("onlylater", "# Soon", new Date(Date.now() + HOUR));
    const rid = (await readIdOf("onlylater"))!;
    expect((await (await call("GET", "/feeds/onlylater")).json()).read_url).toBe(`${BASE}/r/${rid}/feed.xml`);
    expect(await (await call("GET", `/read/${rid}/notes`)).json()).toEqual({ notes: [], next: null });
  });
});
