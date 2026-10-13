import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { hashKey } from "../licenseflow";
import { isLicensed, resetLicensesForTests } from "../licensing";
import { resetFeedsForTests } from "../feeds";
import { resetRateLimitsForTests } from "../limits";
import { createNote } from "../notes";
import { fakeSignature } from "../payments/fake";
import { attachRoute, checkoutRoute, webhookRoute } from "./licenses";

// better-sqlite3 and kysely need Node 22 (the project's version); on an older Node the SQL tests are skipped.
const supported = Number(process.versions.node.split(".")[0]) >= 22;
const SECRET = "whsec-test";

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "notefeed-licenses-http-"));
  vi.stubEnv("DATA_DIR", dir);
  vi.stubEnv("NOTEFEED_STORAGE", "sqlite");
  vi.stubEnv("NOTEFEED_SECRET", "s".repeat(32));
  vi.stubEnv("NOTEFEED_RATE_LIMIT", "0");
  vi.stubEnv("PUBLIC_URL", "https://notefeed.test");
  vi.stubEnv("NOTEFEED_PAYMENT_PROVIDER", "fake");
  vi.stubEnv("NOTEFEED_FAKE_WEBHOOK_SECRET", SECRET);
  resetFeedsForTests();
  resetRateLimitsForTests();
});
afterEach(async () => {
  await resetLicensesForTests();
  vi.unstubAllEnvs();
  resetFeedsForTests();
  await rm(dir, { recursive: true, force: true });
});

const post = (path: string, body: unknown, method = "POST", headers: Record<string, string> = {}) =>
  new Request(`https://notefeed.test${path}`, { method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const webhook = (events: unknown[], secret = SECRET) => {
  const raw = JSON.stringify(events);
  return new Request("https://notefeed.test/api/licenses/webhook", { method: "POST", headers: { "x-fake-signature": fakeSignature(secret, raw) }, body: raw });
};
const buy = async (ref = "sub_1", validUntil: number | null = null) => {
  const { url } = await (await checkoutRoute(post("/api/licenses/checkout", {}))).json();
  const key = new URL(url).hash.slice(1);
  expect((await webhookRoute(webhook([{ type: "started", providerRef: ref, keyHash: hashKey(key), validUntil }]))).status).toBe(200);
  return key;
};

describe.skipIf(!supported)("license endpoints (ADR 0029)", () => {
  test("they are 404 while no payment provider is configured", async () => {
    vi.stubEnv("NOTEFEED_PAYMENT_PROVIDER", "");
    expect((await checkoutRoute(post("/api/licenses/checkout", {}))).status).toBe(404);
    expect((await webhookRoute(webhook([]))).status).toBe(404);
    expect((await attachRoute(post("/api/licenses/attach", { feed: "f", key: "k" }))).status).toBe(404);
  });

  test("the checkout sends the buyer to a success page whose fragment holds the key", async () => {
    const { url } = await (await checkoutRoute(post("/api/licenses/checkout", {}))).json();
    expect(url).toMatch(/^https:\/\/notefeed\.test\/license#[A-Za-z0-9_-]{22}$/);
  });

  test("buy, enter the key on a feed, and the feed is licensed; detach takes it off", async () => {
    await createNote("f", "hi");
    const key = await buy();
    expect(await isLicensed("f")).toBe(false);
    expect((await attachRoute(post("/api/licenses/attach", { feed: "f", key }))).status).toBe(200);
    expect(await isLicensed("f")).toBe(true);
    expect((await attachRoute(post("/api/licenses/attach", { feed: "f" }, "DELETE"))).status).toBe(200);
    expect(await isLicensed("f")).toBe(false);
  });

  test("a wrong key, a missing feed and a second license on a feed are refused", async () => {
    await createNote("f", "hi");
    const key = await buy("sub_1");
    const other = await buy("sub_2");
    expect((await attachRoute(post("/api/licenses/attach", { feed: "f", key: "x".repeat(22) }))).status).toBe(400);
    expect((await attachRoute(post("/api/licenses/attach", { feed: "missing", key }))).status).toBe(404);
    expect((await attachRoute(post("/api/licenses/attach", { feed: "f", key }))).status).toBe(200);
    expect((await attachRoute(post("/api/licenses/attach", { feed: "f", key: other }))).status).toBe(400);
  });

  test("attaching to a protected feed needs its password", async () => {
    const { createProtected } = await import("../feedlock");
    await createProtected("p", "Passw0rd!x");
    const key = await buy();
    expect((await attachRoute(post("/api/licenses/attach", { feed: "p", key }))).status).toBe(401);
    expect((await attachRoute(post("/api/licenses/attach", { feed: "p", key }, "POST", { "x-feed-password": "Passw0rd!x" }))).status).toBe(200);
  });

  test("a bad signature is 400, and the same event twice does no harm", async () => {
    expect((await webhookRoute(webhook([], "wrong"))).status).toBe(400);
    const event = { type: "started", providerRef: "sub_1", keyHash: hashKey("k".repeat(22)), validUntil: null };
    expect((await webhookRoute(webhook([event]))).status).toBe(200);
    expect((await webhookRoute(webhook([event]))).status).toBe(200);
  });

  test("cancelling keeps the license to the end of the period, ending or refunding lapses it, a renewal restores it", async () => {
    await createNote("f", "hi");
    const key = await buy("sub_1");
    await attachRoute(post("/api/licenses/attach", { feed: "f", key }));
    await webhookRoute(webhook([{ type: "cancelled", providerRef: "sub_1", validUntil: Date.now() + 60_000 }]));
    expect(await isLicensed("f")).toBe(true);
    await webhookRoute(webhook([{ type: "cancelled", providerRef: "sub_1", validUntil: Date.now() - 1 }]));
    expect(await isLicensed("f")).toBe(false);
    await webhookRoute(webhook([{ type: "renewed", providerRef: "sub_1", validUntil: Date.now() + 60_000 }]));
    expect(await isLicensed("f")).toBe(true);
    await webhookRoute(webhook([{ type: "refunded", providerRef: "sub_1" }]));
    expect(await isLicensed("f")).toBe(false);
  });
});
