// Drafts over REST (#265): X-Note-Draft on a post, `draft` in the PATCH body, `draft: true` on an owner's note; the read API never has one.
import { beforeEach, expect, test } from "vitest";
import { resetFeedsForTests } from "../feeds";
import { resetRateLimitsForTests } from "../limits";
import { png } from "../testimages";
import { unlock } from "../feedlock";
import { API_PREFIX, dispatch } from "./api";
import { fileRoute, ownerFileRoute } from "./files";

const BASE = "http://localhost:3000";
beforeEach(async () => {
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

// #349: whoever may post sees a draft's and a scheduled note's pictures; the read link still hides them.
async function postWithPicture(headers: Record<string, string>, feed = "f") {
  const form = new FormData();
  form.set("text", "# T ![](a.png)");
  form.set("file", new File([png(1)], "a.png", { type: "image/png" }));
  const made = await (await send("POST", `/feeds/${feed}/notes`, form, null, headers)).json();
  return made.attachments[0].file as string;
}

test("getFile serves a draft's picture to its owner; the read link does not", async () => {
  const file = await postWithPicture({ "x-note-draft": "true" });
  const res = await send("GET", `/feeds/f/files/${file}`, null, null);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("image/png");
  expect(Buffer.from(await res.arrayBuffer()).subarray(1, 4).toString()).toBe("PNG");
  const again = await send("GET", `/feeds/f/files/${file}`, null, null, { "if-none-match": res.headers.get("etag")! });
  expect(again.status).toBe(304);
  const readId = await readIdOf();
  expect((await fileRoute(readId, file)).status).toBe(404);
  expect((await fileRoute(readId, "a.png")).status).toBe(404);
});

test("getFile serves a scheduled note's picture to its owner; the read link does not", async () => {
  const file = await postWithPicture({ "x-note-date": "2099-01-01T00:00:00Z" });
  expect((await send("GET", `/feeds/f/files/${file}`, null, null)).status).toBe(200);
  expect((await fileRoute(await readIdOf(), file)).status).toBe(404);
});

test("getFile is 404 for a file that isn't there and for a name that isn't a note's own", async () => {
  await postWithPicture({});
  expect((await send("GET", "/feeds/f/files/nothere.png", null, null)).status).toBe(404);
  expect((await send("GET", "/feeds/f/files/a.png", null, null)).status).toBe(404);
});

test("getFile on a protected feed needs its password", async () => {
  await send("POST", "/feeds/p/notes", "# First", "text/markdown", { "x-feed-password": "secret-pw" });
  const file = await postWithPicture({ "x-note-draft": "true", "x-feed-password": "secret-pw" }, "p");
  expect((await send("GET", `/feeds/p/files/${file}`, null, null)).status).toBe(401);
  expect((await send("GET", `/feeds/p/files/${file}`, null, null, { "x-feed-password": "secret-pw" })).status).toBe(200);
});

test("the feed's own file route needs the unlock cookie on a protected feed", async () => {
  await send("POST", "/feeds/p/notes", "# First", "text/markdown", { "x-feed-password": "secret-pw" });
  const file = await postWithPicture({ "x-note-draft": "true", "x-feed-password": "secret-pw" }, "p");
  expect((await ownerFileRoute("p", file, undefined)).status).toBe(401);
  expect((await ownerFileRoute("p", file, "wrong")).status).toBe(401);
  const cookie = await unlock("p", "secret-pw", "127.0.0.1");
  const ok = await ownerFileRoute("p", file, cookie);
  expect(ok.status).toBe(200);
  expect(ok.headers.get("content-type")).toBe("image/png");
  expect((await ownerFileRoute("p", "nothere.png", cookie)).status).toBe(404);
});

test("the feed's own file route serves an open feed's draft pictures", async () => {
  const file = await postWithPicture({ "x-note-draft": "true" });
  expect((await ownerFileRoute("f", file, undefined)).status).toBe(200);
  expect((await ownerFileRoute("api", file, undefined)).status).toBe(404);
});
