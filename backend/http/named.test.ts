// A note's name (X-Note-Name) is a stable raw address: /r/<read id>/<name> serves the newest note posted with it (#250).
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { readIdOf, resetFeedsForTests } from "../feeds";
import { resetRateLimitsForTests } from "../limits";
import { createNote } from "../notes";
import { API_PREFIX, dispatch } from "./api";
import { fileRoute } from "./files";
import { processImage } from "../imageprocess";
import { png } from "../testimages";

const BASE = "http://localhost:3000";
beforeEach(async () => {
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "notefeed-named-"));
  process.env.NOTEFEED_SECRET = "test-secret-".padEnd(32, "x");
  resetFeedsForTests();
  resetRateLimitsForTests();
  for (const k of ["NOTEFEED_PASSWORD", "NOTEFEED_RATE_LIMIT", "PUBLIC_URL", "NOTEFEED_IMAGE_UPLOADS"]) delete process.env[k];
});

const PNG = png(1);
async function call(method: string, path: string, init: { body?: BodyInit; headers?: Record<string, string> } = {}) {
  const url = new URL(API_PREFIX + path, BASE);
  const segments = url.pathname.slice(API_PREFIX.length + 1).split("/").map(decodeURIComponent);
  return dispatch(new Request(url, { method, body: init.body, headers: { host: "localhost:3000", ...init.headers } }), segments);
}
const post = async (body: BodyInit, headers: Record<string, string>, type = "text/markdown") => (await call("POST", "/feeds/f/notes", { body, headers: { "content-type": type, ...headers } })).json();
const raw = async (name: string) => {
  const res = await fileRoute((await readIdOf("f"))!, name);
  return { status: res.status, type: res.headers.get("content-type"), text: res.status === 200 ? await res.text() : "" };
};

test("the newest note with the name is served; deleting it brings back the one before", async () => {
  const first = await post("# Skill v1", { "x-note-name": "post-to-notefeed.md" });
  await post("# Unrelated", {});
  expect(await raw("post-to-notefeed.md")).toEqual({ status: 200, type: "text/plain; charset=utf-8", text: "# Skill v1" }); // as a note's own file: a browser shows it
  const second = await post("# Skill v2", { "x-note-name": "post-to-notefeed.md" });
  expect((await raw("post-to-notefeed.md")).text).toBe("# Skill v2");
  expect((await raw(first.file)).text).toBe("# Skill v1"); // each version keeps its own address
  expect((await call("DELETE", `/feeds/f/notes/${second.id}`)).status).toBe(204);
  expect((await raw("post-to-notefeed.md")).text).toBe("# Skill v1");
  expect((await raw("other.md")).status).toBe(404);
});

test("an edit keeps the name; a note dated later is not served by it until then", async () => {
  const made = await post("# Old", { "x-note-name": "notes.md" });
  expect((await call("PUT", `/feeds/f/notes/${made.id}`, { body: "# New", headers: { "content-type": "text/markdown" } })).status).toBe(200);
  expect((await raw("notes.md")).text).toBe("# New");
  await post("# Tomorrow", { "x-note-name": "notes.md", "x-note-date": "2099-01-01" });
  expect((await raw("notes.md")).text).toBe("# New");
});

test("a picture is served by its name with its own type; a note's own file name comes first", async () => {
  await createNote("f", "# x");
  const pic = await post(PNG as BodyInit, { "x-note-name": "logo.png" }, "image/png");
  const byName = await fileRoute((await readIdOf("f"))!, "logo.png");
  expect([byName.status, byName.headers.get("content-type")]).toEqual([200, "image/png"]);
  expect([...new Uint8Array(await byName.arrayBuffer())]).toEqual([...(await processImage(PNG, "png"))]);
  // A name that is another note's file name never takes its address.
  await post("# Impostor", { "x-note-name": pic.file });
  expect((await raw(pic.file)).type).toBe("image/png");
});

test("a name is matched as it was stored: what cleaning changed is no name, and the feed's name never serves it", async () => {
  await post("# x", { "x-note-name": "a/b.md" }); // stored as "ab.md"
  expect((await raw("a/b.md")).status).toBe(404);
  expect((await raw("ab.md")).text).toBe("# x");
  expect((await fileRoute("f", "ab.md")).status).toBe(404);
});
