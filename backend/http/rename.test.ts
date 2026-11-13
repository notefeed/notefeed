// Renaming a feed (#350, ADR 0054): PUT /feeds/{feed} with `name`. Everything goes with the feed; the old name is freed.
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { derivedReadId, hasFeed, readIdOf, resetFeedsForTests } from "../feeds";
import { resetRateLimitsForTests } from "../limits";
import { API_PREFIX, dispatch } from "./api";

const BASE = "http://localhost:3000";
let dir: string;
beforeEach(async () => {
  dir = process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "notefeed-rename-"));
  process.env.NOTEFEED_SECRET = "test-secret-".padEnd(32, "x");
  for (const k of ["NOTEFEED_PASSWORD", "NOTEFEED_RATE_LIMIT", "PUBLIC_URL", "NOTEFEED_RESERVED_FEEDS", "NOTEFEED_RESERVED_PASSWORD"]) delete process.env[k];
  resetFeedsForTests();
  resetRateLimitsForTests();
});

async function call(method: string, path: string, body?: BodyInit, headers: Record<string, string> = {}) {
  const url = new URL(API_PREFIX + path, BASE);
  return dispatch(new Request(url, { method, body, headers: { host: "localhost:3000", ...headers } }), url.pathname.slice(API_PREFIX.length + 1).split("/"));
}
const post = (feed: string, md: string, headers: Record<string, string> = {}) =>
  call("POST", `/feeds/${feed}/notes`, md, { "content-type": "text/markdown", ...headers });
const rename = (feed: string, name: string, headers: Record<string, string> = {}) =>
  call("PUT", `/feeds/${feed}`, JSON.stringify({ title: "T", description: "D", name }), { "content-type": "application/json", ...headers });

test("a rename keeps the notes, the settings and the read link; the old name is free", async () => {
  const made = await (await post("old-name", "# First")).json();
  const res = await rename("old-name", "new-name");
  expect(res.status).toBe(200);
  const feed = await res.json();
  expect(feed).toMatchObject({ name: "new-name", title: "T", description: "D", read_url: made.read_url });
  expect((await (await call("GET", `/feeds/new-name/notes/${made.id}`)).json()).content).toBe("# First");
  const readId = /\/r\/([^/]+)\//.exec(made.read_url)![1];
  expect(((await (await call("GET", `/read/${readId}/notes`)).json()).notes as { id: string }[]).map((n) => n.id)).toEqual([made.id]);
  expect(await hasFeed("old-name")).toBe(false);
  expect((await call("GET", "/feeds/old-name")).status).toBe(404);
  // A post to the old name makes a new, empty feed with its own read link.
  const fresh = await (await post("old-name", "# Again")).json();
  expect(fresh.read_url).not.toBe(made.read_url);
});

test("a taken, reserved or badly formed name is refused, and nothing is saved", async () => {
  await post("mine", "# Mine");
  await post("theirs", "# Theirs");
  for (const [name, status] of [
    ["theirs", 409],
    ["api", 409],
    ["Bad Name", 400],
    ["x".repeat(65), 400],
  ] as const) {
    const res = await rename("mine", name);
    expect(res.status).toBe(status);
    if (status === 409) expect((await res.json()).code).toBe("taken");
  }
  expect((await (await call("GET", "/feeds/mine")).json()).title).toBe(""); // the title in the same PUT was not saved
  expect(await hasFeed("mine")).toBe(true);
});

test("the current name or an empty one is no rename", async () => {
  await post("mine", "# Mine");
  expect((await (await rename("mine", "mine")).json()).name).toBe("mine");
  expect((await (await rename("mine", "")).json()).name).toBe("mine");
});

test("a protected feed needs its password and keeps it under the new name", async () => {
  await post("locked", "# Hi", { "x-feed-password": "Passw0rd!x" });
  expect((await rename("locked", "moved")).status).toBe(401);
  expect((await rename("locked", "moved", { "x-feed-password": "Passw0rd!x" })).status).toBe(200);
  expect((await call("GET", "/feeds/moved")).status).toBe(401);
  expect((await call("GET", "/feeds/moved", undefined, { "x-feed-password": "Passw0rd!x" })).status).toBe(200);
});

test("a feed whose read id is derived from its name keeps that read id", async () => {
  await post("legacy", "# Old");
  const derived = derivedReadId("legacy");
  await rm(join(dir, "legacy", ".readid")); // as a feed from before `.readid`
  resetFeedsForTests();
  expect(await readIdOf("legacy")).toBe(derived);
  await rename("legacy", "renamed-legacy");
  expect(await readIdOf("renamed-legacy")).toBe(derived);
  expect(await readFile(join(dir, "renamed-legacy", ".readid"), "utf8")).toBe(derived);
  expect(
    await stat(join(dir, "legacy")).then(
      () => true,
      () => false,
    ),
  ).toBe(false);
});

test("a reserved feed keeps its name, and no feed takes a reserved one", async () => {
  process.env.NOTEFEED_RESERVED_FEEDS = "news";
  process.env.NOTEFEED_RESERVED_PASSWORD = "hunter22";
  resetFeedsForTests();
  await call("GET", "/feeds/news", undefined, { "x-feed-password": "hunter22" }); // makes the reserved feeds
  expect((await rename("news", "other", { "x-feed-password": "hunter22" })).status).toBe(400);
  await post("mine", "# Mine");
  expect((await rename("mine", "news")).status).toBe(409);
});
