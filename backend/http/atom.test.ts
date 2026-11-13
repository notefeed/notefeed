// Atom beside RSS on the read link (#324): the same notes, ids that are the notes' URLs on the read link, `published` the note's date
// and `updated` its last change; never the feed name (V10).
import { beforeEach, expect, test } from "vitest";
import { readIdOf, resetFeedsForTests } from "../feeds";
import { changeDate, changeDraft, changeMeta, createImageNote, createNote, createNoteOf, MARKDOWN, replaceContent } from "../notes";
import { png } from "../testimages";
import { atomRoute, rssRoute } from "./rss";

const BASE = "http://localhost:3000";
beforeEach(async () => {
  process.env.NOTEFEED_SECRET = "test-secret-".padEnd(32, "x");
  resetFeedsForTests();
  for (const k of ["NOTEFEED_PASSWORD", "NOTEFEED_TITLE", "PUBLIC_URL"]) delete process.env[k];
});

const req = (id: string, file: string) => new Request(`${BASE}/r/${id}/${file}`, { headers: { host: "localhost:3000" } });
const atom = async (id: string) => (await atomRoute(req(id, "atom.xml"), id)).text();
const entries = (xml: string) => [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
const field = (entry: string, name: string) => new RegExp(`<${name}>(.*?)</${name}>`).exec(entry)?.[1];
const text = (s: string) => new TextEncoder().encode(s);

test("serves the same notes as RSS, as Atom entries with read-id ids", async () => {
  const { note: a } = await createNote("secretname", "# One", new Date("2026-09-29T10:00:00Z"));
  const { note: b } = await createNote("secretname", "# Two\n\nSome **bold** text", new Date("2026-09-29T11:00:00Z"));
  const rid = (await readIdOf("secretname"))!;
  const res = await atomRoute(req(rid, "atom.xml"), rid);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("application/atom+xml; charset=utf-8");
  const xml = await res.text();
  expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<feed xmlns="http:\/\/www.w3.org\/2005\/Atom">/);
  for (const el of ["<id>", "<title>", "<updated>", "<author><name>"]) expect(xml).toContain(el);
  expect(xml).toContain(`<link rel="self" type="application/atom+xml" href="${BASE}/r/${rid}/atom.xml"/>`);
  const [first, second] = entries(xml);
  expect(field(first, "id")).toBe(`${BASE}/r/${rid}/${b.id}`);
  expect(field(second, "id")).toBe(`${BASE}/r/${rid}/${a.id}`);
  expect(field(first, "title")).toBe("Two");
  expect(field(first, "published")).toBe("2026-09-29T11:00:00.000Z");
  // Never edited: updated is its date, even when it was posted later with that date (back-dated, imported).
  expect(field(first, "updated")).toBe("2026-09-29T11:00:00.000Z");
  expect(first).toContain('<content type="html"><![CDATA[');
  expect(first).toContain("<strong>bold</strong>");
  // The same items as RSS, in the same order.
  const rss = await (await rssRoute(req(rid, "feed.xml"), rid)).text();
  expect([...rss.matchAll(/<guid isPermaLink="true">(.*?)<\/guid>/g)].map((m) => m[1])).toEqual(entries(xml).map((e) => field(e, "id")));
  expect(xml).not.toContain("secretname");
});

test("an edit moves updated and keeps published; the feed's updated is the newest change", async () => {
  const { note } = await createNote("f", "# Old", new Date("2026-01-01T10:00:00Z"));
  const rid = (await readIdOf("f"))!;
  const before = Date.now();
  await replaceContent("f", note.id, text("# New"), "text/markdown");
  const [entry] = entries(await atom(rid));
  expect(field(entry, "published")).toBe("2026-01-01T10:00:00.000Z");
  expect(Date.parse(field(entry, "updated")!)).toBeGreaterThanOrEqual(before);
  expect(field(entry, "title")).toBe("New");
  const xml = await atom(rid);
  expect(/<feed[\s\S]*?<updated>(.*?)<\/updated>/.exec(xml)![1]).toBe(field(entry, "updated"));
});

test("a change of title, tags or date moves updated too", async () => {
  const { note } = await createNote("f", "# T", new Date("2026-01-01T10:00:00Z"));
  const rid = (await readIdOf("f"))!;
  await changeMeta("f", note.id, { tags: ["x"] });
  const [tagged] = entries(await atom(rid));
  expect(Date.parse(field(tagged, "updated")!)).toBeGreaterThan(Date.parse("2026-01-02T00:00:00Z"));
  expect(tagged).toContain('<category term="x"/>');
  await changeDate("f", note.id, new Date("2026-02-01T10:00:00Z"));
  const [moved] = entries(await atom(rid));
  expect(field(moved, "published")).toBe("2026-02-01T10:00:00.000Z");
});

test("drafts and scheduled notes are left out, as in RSS", async () => {
  await createNote("f", "# Shown", new Date("2026-01-01T10:00:00Z"));
  await createNoteOf("f", MARKDOWN, "md", text("# Drafted"), { draft: true }, new Date("2026-01-02T10:00:00Z"));
  await createNote("f", "# Later", new Date("2099-01-01T00:00:00Z"));
  const xml = await atom((await readIdOf("f"))!);
  expect(entries(xml)).toHaveLength(1);
  expect(xml).not.toContain("Drafted");
  expect(xml).not.toContain("Later");
  const { note } = await createNoteOf("f", MARKDOWN, "md", text("# Was a draft"), { draft: true }, new Date("2026-01-03T10:00:00Z"));
  await changeDraft("f", note.id, false);
  expect(await atom((await readIdOf("f"))!)).toContain("Was a draft");
});

test("a picture note has its file as an enclosure link", async () => {
  const { note } = await createImageNote("f", png(1), { alt: "A pixel" });
  const rid = (await readIdOf("f"))!;
  const [entry] = entries(await atom(rid));
  expect(entry).toContain(`<link rel="enclosure" href="${BASE}/r/${rid}/${note.file}"`);
  expect(field(entry, "title")).toBe("A pixel");
});

test("an unknown read id is an empty feed, still valid Atom", async () => {
  const xml = await atom("AAAAAAAAAAAAAAAAAAAAAA");
  expect(entries(xml)).toHaveLength(0);
  expect(xml).toContain("<updated>");
});
