// What the Shortcut sends, as the server answers it (#334): Authorization: Bearer <server password>, empty where the server has none,
// and X-Feed-Password, empty for an open feed. Both empty must post on an open instance; with NOTEFEED_PASSWORD the bearer is checked.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { resetFeedsForTests } from "../backend/feeds";
import { API_PREFIX, dispatch } from "../backend/http/api";
import { resetRateLimitsForTests } from "../backend/limits";
import { png } from "../backend/testimages";

beforeEach(async () => {
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "notefeed-shortcut-"));
  process.env.NOTEFEED_SECRET = "s".repeat(32);
  for (const k of ["NOTEFEED_PASSWORD", "NOTEFEED_RATE_LIMIT", "PUBLIC_URL"])
    delete process.env[k];
  resetFeedsForTests();
  resetRateLimitsForTests();
});

// As the Shortcut's form: a text field, a JPEG, and both headers, whatever their values.
async function share(feed: string, serverPassword: string, feedPassword = "") {
  const form = new FormData();
  form.set("text", "From the phone");
  form.set("file", new File([png(1)], "IMG_0001.jpg", { type: "image/png" }));
  const url = new URL(
    `${API_PREFIX}/feeds/${feed}/notes`,
    "http://localhost:3000",
  );
  const headers = {
    host: "localhost:3000",
    authorization: `Bearer ${serverPassword}`,
    "x-feed-password": feedPassword,
  };
  return dispatch(new Request(url, { method: "POST", body: form, headers }), [
    "feeds",
    feed,
    "notes",
  ]);
}

test("on a server without a password, an empty bearer and an empty feed password post", async () => {
  expect((await share("phone", "")).status).toBe(201);
});

test("on a server with a password, the bearer is checked", async () => {
  process.env.NOTEFEED_PASSWORD = "server-pw";
  expect((await share("phone", "")).status).toBe(401);
  expect((await share("phone", "wrong")).status).toBe(401);
  expect((await share("phone", "server-pw")).status).toBe(201);
});
