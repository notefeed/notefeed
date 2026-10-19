import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { hashKey } from "../licenseflow";
import { isLicensed, resetLicensesForTests } from "../licensing";
import { resetFeedsForTests } from "../feeds";
import { resetRateLimitsForTests } from "../limits";
import { createNote } from "../notes";
import { cancelled, fakeSignature } from "../payments/fake";
import { API_PREFIX, dispatch } from "./api";
import { attachRoute, checkoutRoute, portalRoute, webhookRoute } from "./licenses";

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
    expect((await portalRoute(post("/api/licenses/portal", { key: "k" }))).status).toBe(404);
  });

  test("the checkout sends the buyer to a success page whose fragment holds the key", async () => {
    const { url } = await (await checkoutRoute(post("/api/licenses/checkout", {}))).json();
    expect(url).toMatch(/^https:\/\/notefeed\.test\/license#[A-Za-z0-9_-]{22}$/);
  });

  test("a yearly license can be bought once its price is set, and the period must be month or year", async () => {
    expect((await checkoutRoute(post("/api/licenses/checkout", { period: "year" }))).status).toBe(400);
    expect((await checkoutRoute(post("/api/licenses/checkout", { period: "week" }))).status).toBe(400);
    vi.stubEnv("NOTEFEED_LICENSE_PRICE_YEARLY", "19.90 € per year");
    const { url } = await (await checkoutRoute(post("/api/licenses/checkout", { period: "year" }))).json();
    expect(url).toMatch(/^https:\/\/notefeed\.test\/license#[A-Za-z0-9_-]{22}$/);
    expect((await checkoutRoute(post("/api/licenses/checkout", { period: "week" }))).status).toBe(400);
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

  test("X-License-Key on the post that creates a protected feed puts the license on it (issue #193)", async () => {
    const { protectedFeed } = await import("../feedlock");
    const key = await buy();
    const create = (feed: string, headers: Record<string, string>, body: BodyInit = "# Hi", type: string | null = "text/markdown") =>
      dispatch(new Request(`https://notefeed.test${API_PREFIX}/feeds/${feed}/notes`, { method: "POST", headers: { host: "notefeed.test", ...(type && { "content-type": type }), ...headers }, body }), ["feeds", feed, "notes"]);
    const protect = { "x-feed-password": "Passw0rd!x" };
    expect((await create("p", protect)).status).toBe(402);
    expect((await create("p", { ...protect, "x-license-key": "x".repeat(22) })).status).toBe(400);
    expect(await isLicensed("p")).toBe(false);
    expect((await create("p", { ...protect, "x-license-key": key })).status).toBe(201);
    expect(await protectedFeed("p")).toBe(true);
    expect(await isLicensed("p")).toBe(true);
    // The same with a text and its pictures in one multipart body.
    const form = new FormData();
    form.append("text", new Blob(["hi"], { type: "text/markdown" }), "text.md");
    expect((await create("q", { ...protect, "x-license-key": key }, form, null)).status).toBe(201);
    expect(await isLicensed("q")).toBe(true);
    expect(await isLicensed("p")).toBe(false); // moved, as from the settings
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

  // The provider retries a delivery for hours, so the end of a period can arrive after the payment retried for it went through.
  test("the end of a period that a later payment has already extended does not lapse the license", async () => {
    await createNote("f", "hi");
    const key = await buy("sub_1");
    await attachRoute(post("/api/licenses/attach", { feed: "f", key }));
    const ran = Date.now() - 1;
    await webhookRoute(webhook([{ type: "renewed", providerRef: "sub_1", validUntil: Date.now() + 60_000 }]));
    await webhookRoute(webhook([{ type: "ended", providerRef: "sub_1", periodEnd: ran }]));
    expect(await isLicensed("f")).toBe(true);
    // The period that has ended is the license's own, or the provider does not say which: it lapses.
    await webhookRoute(webhook([{ type: "ended", providerRef: "sub_1", periodEnd: null }]));
    expect(await isLicensed("f")).toBe(false);
  });

  test("a refund ends the subscription at the provider too, so it is not charged again", async () => {
    cancelled.length = 0;
    await buy("sub_1");
    await webhookRoute(webhook([{ type: "renewed", providerRef: "sub_1", validUntil: null }]));
    expect(cancelled).toEqual([]);
    expect((await webhookRoute(webhook([{ type: "refunded", providerRef: "sub_1" }]))).status).toBe(200);
    expect(cancelled).toEqual(["sub_1"]);
  });

  // The provider answers that cancel with a cancel event carrying the period's end (seen in the sandbox): the license stays lapsed.
  test("the cancel that follows a refund does not bring the license back for the rest of the period", async () => {
    await createNote("f", "hi");
    const key = await buy("sub_1");
    await attachRoute(post("/api/licenses/attach", { feed: "f", key }));
    await webhookRoute(webhook([{ type: "refunded", providerRef: "sub_1" }]));
    await webhookRoute(webhook([{ type: "cancelled", providerRef: "sub_1", validUntil: Date.now() + 60_000 }]));
    expect(await isLicensed("f")).toBe(false);
  });

  test("the key opens the provider's page for its subscription; anything else is refused", async () => {
    const key = await buy("sub_1");
    const res = await portalRoute(post("/api/licenses/portal", { key: ` ${key} ` }));
    expect(res.status).toBe(200);
    expect((await res.json()).url).toBe("https://fake.invalid/portal/sub_1");
    expect((await portalRoute(post("/api/licenses/portal", { key: "x".repeat(22) }))).status).toBe(400);
    expect((await portalRoute(post("/api/licenses/portal", { key: "f" }))).status).toBe(400);
    expect((await portalRoute(post("/api/licenses/portal", {}))).status).toBe(400);
  });
});
