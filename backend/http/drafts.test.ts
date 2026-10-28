// Drafts over REST (#265): X-Note-Draft on a post, `draft` in the PATCH body, `draft: true` on an owner's note; the read API never has one.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { resetFeedsForTests } from "../feeds";
import { resetRateLimitsForTests } from "../limits";
import { png } from "../testimages";
import { API_PREFIX, dispatch } from "./api";

const BASE = "http://localhost:3000";
beforeEach(async () => {
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "notefeed-drafts-"));
  process.env.NOTEFEED_SECRET = "test-secret-".padEnd(32, "x");
  resetFeedsForTests();
  resetRateLimitsForTests();
  for (const k of ["NOTEFEED_PASSWORD", "NOTEFEED_RATE_LIMIT", "PUBLIC_URL"]) delete process.env[k];
});

function send(method: string, path: string, body: BodyInit | null, type: string | null, headers: Record<string, string> = {}) {
  const h = new Headers({ host: "localhost:3000", ...headers });
  if (type !== null) h.set("content-type", type);
  const url = new URL(API_PREFIX + path, BASE);
  return dispatch(new Request(url, { method, body, headers: h }), url.pathname.slice(API_PREFIX.length + 1).split("/"));
}
const patch = (id: string, body: unknown) => send("PATCH", `/feeds/f/notes/${id}`, JSON.stringify(body), "application/json");
const readIdOf = async () => /\/r\/([^/]+)/.exec((await (await send("GET", "/feeds/f", null, null)).json()).read_url)![1];
const readList = async (readId: string) => ((await (await send("GET", `/read/${readId}/notes`, null, null)).json()).notes as { id: string }[]).map((n) => n.id);

test("a post with X-Note-Draft: true is a draft, for the owner only", async () => {
  const res = await send("POST", "/feeds/f/notes", "# Draft", "text/markdown", { "x-note-draft": "true" });
  expect(res.status).toBe(201);
  const made = await res.json();
  expect(made.draft).toBe(true);
  expect((await (await send("GET", `/feeds/f/notes/${made.id}`, null, null)).json()).draft).toBe(true);
  const readId = await readIdOf();
  expect(await readList(readId)).not.toContain(made.id);
  expect((await send("GET", `/read/${readId}/notes/${made.id}`, null, null)).status).toBe(404);
});

test("X-Note-Draft takes true or false, nothing else", async () => {
  const off = await (await send("POST", "/feeds/f/notes", "# Out", "text/markdown", { "x-note-draft": "false" })).json();
  expect(off.draft).toBeUndefined();
  const bad = await send("POST", "/feeds/f/notes", "# Bad", "text/markdown", { "x-note-draft": "yes" });
  expect(bad.status).toBe(400);
  expect((await bad.json()).error).toContain("X-Note-Draft");
});

test("a multipart post as a draft makes the text and its pictures drafts", async () => {
  const form = new FormData();
  form.set("text", "# T ![](a.png)");
  form.set("file", new File([png(1)], "a.png", { type: "image/png" }));
  const made = await (await send("POST", "/feeds/f/notes", form, null, { "x-note-draft": "true" })).json();
  expect(made.draft).toBe(true);
  expect(made.attachments.map((p: { draft?: boolean }) => p.draft)).toEqual([true]);
});

test("PATCH draft alone publishes and makes a draft again", async () => {
  const made = await (await send("POST", "/feeds/f/notes", "# D", "text/markdown", { "x-note-draft": "true" })).json();
  const res = await patch(made.id, { draft: false });
  expect(res.status).toBe(200);
  expect((await res.json()).draft).toBeUndefined();
  const readId = await readIdOf();
  expect(await readList(readId)).toContain(made.id);
  expect((await (await patch(made.id, { draft: true })).json()).draft).toBe(true);
  expect(await readList(readId)).not.toContain(made.id);
  expect((await patch(made.id, { draft: "no" })).status).toBe(400);
});
