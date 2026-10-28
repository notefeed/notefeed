import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { isLicensed, resetLicensesForTests } from "../licensing";
import { resetFeedsForTests } from "../feeds";
import { resetRateLimitsForTests } from "../limits";
import { createNote } from "../notes";
import { resetPlansForTests } from "../payments/creem";
import { cancelled, fakeKey, fakeSignature } from "../payments/fake";
import { API_PREFIX, dispatch } from "./api";
import { attachRoute, checkoutRoute, feedLicenseRoute, keyRoute, webhookRoute } from "./licenses";

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

const stubAll = (vars: Record<string, string>) => Object.entries(vars).forEach(([k, v]) => vi.stubEnv(k, v));
const post = (path: string, body: unknown, method = "POST", headers: Record<string, string> = {}) =>
  new Request(`https://notefeed.test${path}`, { method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const webhook = (events: unknown[], secret = SECRET) => {
  const raw = JSON.stringify(events);
  return new Request("https://notefeed.test/api/licenses/webhook", { method: "POST", headers: { "x-fake-signature": fakeSignature(secret, raw) }, body: raw });
};
// Bought: the checkout comes back with its id, the success page asks for its key, the webhook starts the license.
const buy = async (ref = "sub_1", validUntil: number | null = null) => {
  const { url } = await (await checkoutRoute(post("/api/licenses/checkout", {}))).json();
  const { key } = await (await keyRoute(post("/api/licenses/key", { checkout: new URL(url).searchParams.get("checkout_id") }))).json();
  expect((await webhookRoute(webhook([{ type: "started", providerRef: ref, key, validUntil }]))).status).toBe(200);
  return key as string;
};

describe.skipIf(!supported)("license endpoints (ADR 0029)", () => {
  test("they are 404 while no payment provider is configured", async () => {
    vi.stubEnv("NOTEFEED_PAYMENT_PROVIDER", "");
    expect((await checkoutRoute(post("/api/licenses/checkout", {}))).status).toBe(404);
    expect((await webhookRoute(webhook([]))).status).toBe(404);
    expect((await attachRoute(post("/api/licenses/attach", { feed: "f", key: "k" }))).status).toBe(404);
    expect((await keyRoute(post("/api/licenses/key", { checkout: "fake_1" }))).status).toBe(404);
  });

  test("the checkout comes back to the license page with its id, and the provider's key is had for that id alone", async () => {
    const { url } = await (await checkoutRoute(post("/api/licenses/checkout", {}))).json();
    expect(url).toMatch(/^https:\/\/notefeed\.test\/license\?checkout_id=fake_[A-Za-z0-9_-]+$/);
    const checkout = new URL(url).searchParams.get("checkout_id")!;
    const res = await keyRoute(post("/api/licenses/key", { checkout }));
    expect(res.status).toBe(200);
    expect((await res.json()).key).toBe(fakeKey(SECRET, checkout));
    expect((await keyRoute(post("/api/licenses/key", { checkout: "ch_unknown" }))).status).toBe(404); // not completed, or none
    expect((await keyRoute(post("/api/licenses/key", { checkout: "a b" }))).status).toBe(400);
    expect((await keyRoute(post("/api/licenses/key", {}))).status).toBe(400);
  });

  test("both periods are sold with the fake provider, and the period must be month or year", async () => {
    for (const period of ["month", "year"]) {
      const { url } = await (await checkoutRoute(post("/api/licenses/checkout", { period }))).json();
      expect(url).toMatch(/^https:\/\/notefeed\.test\/license\?checkout_id=fake_/);
    }
    expect((await checkoutRoute(post("/api/licenses/checkout", { period: "week" }))).status).toBe(400);
  });

  test("a period the provider does not sell is refused before any checkout: no yearly product, or one that is not active", async () => {
    resetPlansForTests();
    stubAll({ NOTEFEED_PAYMENT_PROVIDER: "creem", NOTEFEED_CREEM_API_KEY: "creem_test_x", NOTEFEED_CREEM_PRODUCT_ID: "prod_month", NOTEFEED_CREEM_WEBHOOK_SECRET: "whsec" });
    const fetch = vi.fn(async (url: string) => (url.includes("/products") ? Response.json({ name: "Monthly", price: 199, currency: "EUR", status: url.endsWith("prod_month") ? "active" : "archived" }) : Response.json({ checkout_url: "https://creem.test/pay" })));
    vi.stubGlobal("fetch", fetch);
    try {
      expect((await checkoutRoute(post("/api/licenses/checkout", { period: "year" }))).status).toBe(400);
      vi.stubEnv("NOTEFEED_CREEM_PRODUCT_ID_YEARLY", "prod_year"); // configured, but archived at Creem
      expect((await checkoutRoute(post("/api/licenses/checkout", { period: "year" }))).status).toBe(400);
      expect(fetch.mock.calls.some(([u]) => String(u).endsWith("/checkouts"))).toBe(false);
      expect((await (await checkoutRoute(post("/api/licenses/checkout", { period: "month" }))).json()).url).toBe("https://creem.test/pay");
    } finally {
      vi.unstubAllGlobals();
      resetPlansForTests();
    }
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

  test("X-License-Key licenses the open feed its post creates; a bad key creates nothing (#247)", async () => {
    const key = await buy();
    const create = (feed: string, headers: Record<string, string>) =>
      dispatch(new Request(`https://notefeed.test${API_PREFIX}/feeds/${feed}/notes`, { method: "POST", headers: { host: "notefeed.test", "content-type": "text/markdown", ...headers }, body: "# Hi" }), ["feeds", feed, "notes"]);
    const bad = await create("o", { "x-license-key": "x".repeat(22) });
    expect([bad.status, (await bad.json()).error]).toEqual([400, "that is not a license key"]);
    expect((await create("o", { "x-license-key": key })).status).toBe(201);
    expect(await isLicensed("o")).toBe(true);
    const feed = await (await dispatch(new Request(`https://notefeed.test${API_PREFIX}/feeds/o`, { headers: { host: "notefeed.test" } }), ["feeds", "o"])).json();
    expect(feed).toMatchObject({ protected: false, free_tier: null });
  });

  test("PUT and DELETE /api/v1/feeds/{feed}/license put a license on a feed and take it off (#247)", async () => {
    const key = await buy();
    const api = (feed: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
      dispatch(
        new Request(`https://notefeed.test${API_PREFIX}/feeds/${feed}/license`, { method, headers: { host: "notefeed.test", "content-type": "application/json", ...headers }, ...(body !== undefined && { body: JSON.stringify(body) }) }),
        ["feeds", feed, "license"],
      );
    expect((await api("f", "PUT", { key })).status).toBe(404); // no such feed yet
    await createNote("f", "hi");
    expect((await api("f", "PUT", { nope: 1 })).status).toBe(400);
    expect((await api("f", "PUT", { key: "k".repeat(22) })).status).toBe(400);
    const put = await api("f", "PUT", { key: ` ${key} ` });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ name: "f", protected: false, free_tier: null });
    expect(await isLicensed("f")).toBe(true);
    const del = await api("f", "DELETE");
    expect(del.status).toBe(200);
    expect((await del.json()).free_tier).toMatchObject({ notes: 1 });
    expect(await isLicensed("f")).toBe(false);
    // A protected feed needs its password; a lapsed key is 402.
    const { createProtected } = await import("../feedlock");
    await createProtected("p", "Passw0rd!x");
    expect((await api("p", "PUT", { key })).status).toBe(401);
    expect((await api("p", "PUT", { key }, { "x-feed-password": "Passw0rd!x" })).status).toBe(200);
    await webhookRoute(webhook([{ type: "refunded", providerRef: "sub_1" }]));
    expect((await api("f", "PUT", { key })).status).toBe(402);
    // Where licenses are not sold, the route is not there.
    vi.stubEnv("NOTEFEED_PAYMENT_PROVIDER", "");
    expect((await api("f", "PUT", { key })).status).toBe(404);
    expect((await api("f", "DELETE")).status).toBe(404);
  });

  test("attaching to a protected feed needs its password", async () => {
    const { createProtected } = await import("../feedlock");
    await createProtected("p", "Passw0rd!x");
    const key = await buy();
    expect((await attachRoute(post("/api/licenses/attach", { feed: "p", key }))).status).toBe(401);
    expect((await attachRoute(post("/api/licenses/attach", { feed: "p", key }, "POST", { "x-feed-password": "Passw0rd!x" }))).status).toBe(200);
  });

  // The settings page's own route sits under the feed's path, where the unlock cookie is sent (its paths are /<feed> and the
  // feed's API path); /api/licenses/attach never gets that cookie, so a protected feed's page could not enter a key there.
  test("the settings page enters and removes a key on a protected feed with its unlock cookie", async () => {
    const { cookieValue, createProtected } = await import("../feedlock");
    await createProtected("p", "Passw0rd!x");
    const key = await buy();
    const page = (method: string, body: unknown, cookie?: string, origin = "https://notefeed.test") =>
      new Request("https://notefeed.test/p/license", { method, headers: { "content-type": "application/json", origin, ...(cookie ? { cookie: `nf_feed_p=${cookie}` } : {}) }, body: JSON.stringify(body) });
    const unlock = (await cookieValue("p"))!;
    expect((await feedLicenseRoute(page("POST", { key }), "p")).status).toBe(401);
    expect((await feedLicenseRoute(page("POST", { key }, unlock, "https://evil.test"), "p")).status).toBe(401); // another site's request
    expect((await feedLicenseRoute(page("POST", { key }, unlock), "p")).status).toBe(200);
    expect(await isLicensed("p")).toBe(true);
    expect((await feedLicenseRoute(page("DELETE", {}, unlock), "p")).status).toBe(200);
    expect(await isLicensed("p")).toBe(false);
  });

  test("a new key replaces a lapsed license on the feed; an active one still has to be taken off first", async () => {
    await createNote("f", "hi");
    const old = await buy("sub_old");
    expect((await attachRoute(post("/api/licenses/attach", { feed: "f", key: old }))).status).toBe(200);
    const next = await buy("sub_new");
    expect((await attachRoute(post("/api/licenses/attach", { feed: "f", key: next }))).status).toBe(400); // the old one is active
    await webhookRoute(webhook([{ type: "refunded", providerRef: "sub_old" }]));
    expect((await attachRoute(post("/api/licenses/attach", { feed: "f", key: next }))).status).toBe(200);
    expect(await isLicensed("f")).toBe(true);
  });

  test("a bad signature is 400, and the same event twice does no harm", async () => {
    expect((await webhookRoute(webhook([], "wrong"))).status).toBe(400);
    const event = { type: "started", providerRef: "sub_1", key: "k".repeat(22), validUntil: null };
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

  test("no route turns a key into the provider's portal (#316)", async () => {
    expect(await import("./licenses")).not.toHaveProperty("portalRoute");
  });
});

// A lost feed password (ADR 0037): there are no accounts, so the only proof of owning a protected feed is the license key on it,
// which the buyer finds again in the provider's receipt and portal. The password itself stays shareable; the key stays the buyer's.
describe.skipIf(!supported)("recovering a feed password with the feed's license key", () => {
  const recover = async (fields: Record<string, string>) => {
    const { feedAccessRoute } = await import("./feedsession");
    return feedAccessRoute(
      new Request("https://notefeed.test/p/access", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://notefeed.test" }, body: new URLSearchParams({ action: "recover", ...fields }) }),
      "p",
    );
  };
  const opens = async (password: string) => {
    const { unlock } = await import("../feedlock");
    return unlock("p", password, "1.2.3.4").then(
      () => true,
      () => false,
    );
  };
  const protectedWithLicense = async (ref = "sub_1") => {
    const { createProtected } = await import("../feedlock");
    await createProtected("p", "Passw0rd!x");
    const key = await buy(ref);
    expect((await attachRoute(post("/api/licenses/attach", { feed: "p", key }, "POST", { "x-feed-password": "Passw0rd!x" }))).status).toBe(200);
    return key;
  };

  test("the key on the feed sets a new password, or removes it; any other key is refused", async () => {
    const { protectedFeed } = await import("../feedlock");
    const key = await protectedWithLicense();
    const other = await buy("sub_2"); // a real key, but not this feed's
    for (const wrong of ["k".repeat(22), other, ""]) {
      const res = await recover({ key: wrong, next: "N3wPassw0rd!" });
      expect(res.headers.get("location")).toBe("/p?form=recover&error=auth");
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    expect(await opens("Passw0rd!x")).toBe(true);

    const set = await recover({ key, next: "N3wPassw0rd!" });
    expect(set.headers.get("location")).toBe("/p/settings?saved=password-recovered#access");
    expect(set.headers.getSetCookie()).toHaveLength(2);
    expect(await opens("N3wPassw0rd!")).toBe(true);
    expect(await opens("Passw0rd!x")).toBe(false);

    const removed = await recover({ key: ` ${key} `, next: "" });
    expect(removed.headers.get("location")).toBe("/p");
    expect(removed.headers.getSetCookie().every((c) => c.includes("Max-Age=0"))).toBe(true);
    expect(await protectedFeed("p")).toBe(false);
  });

  test("from the settings page, a refusal goes back to the settings' recovery part (#297)", async () => {
    const key = await protectedWithLicense();
    const res = await recover({ key: "k".repeat(22), next: "N3wPassw0rd!", from: "settings" });
    expect(res.headers.get("location")).toBe("/p/settings?form=recover&error=auth#access");
    const set = await recover({ key, next: "N3wPassw0rd!", from: "settings" });
    expect(set.headers.get("location")).toBe("/p/settings?saved=password-recovered#access");
    expect(await opens("N3wPassw0rd!")).toBe(true);
  });

  test("a lapsed license's key removes the password but cannot set a new one", async () => {
    const { protectedFeed } = await import("../feedlock");
    const key = await protectedWithLicense();
    await webhookRoute(webhook([{ type: "refunded", providerRef: "sub_1" }]));
    expect((await recover({ key, next: "N3wPassw0rd!" })).headers.get("location")).toBe("/p?form=recover&error=license_required");
    expect(await opens("Passw0rd!x")).toBe(true);
    expect((await recover({ key, next: "" })).headers.get("location")).toBe("/p");
    expect(await protectedFeed("p")).toBe(false);
  });

  test("a bad new password is said before the key is tried, and wrong keys count against the password limit", async () => {
    const key = await protectedWithLicense();
    expect((await recover({ key: "k".repeat(22), next: " padded " })).headers.get("location")).toBe("/p?form=recover&error=invalid_body");
    vi.stubEnv("NOTEFEED_RATE_LIMIT", "2");
    resetRateLimitsForTests();
    for (let i = 0; i < 2; i++) await recover({ key: "k".repeat(22), next: "" });
    expect((await recover({ key, next: "" })).headers.get("location")).toMatch(/^\/p\?form=recover&error=too_many_attempts&retry=\d+$/);
  });
});

// The same recovery for scripts and agents: POST /api/v1/feeds/{feed}/password/recover with the key (ADR 0037).
describe.skipIf(!supported)("recovering a feed password through the API", () => {
  const recover = (body: unknown) =>
    dispatch(new Request(`https://notefeed.test${API_PREFIX}/feeds/p/password/recover`, { method: "POST", headers: { host: "notefeed.test", "content-type": "application/json" }, body: JSON.stringify(body) }), ["feeds", "p", "password", "recover"]);
  const opens = async (password: string) => {
    const { unlock } = await import("../feedlock");
    return unlock("p", password, "1.2.3.4").then(
      () => true,
      () => false,
    );
  };
  const protectedWithLicense = async () => {
    const { createProtected } = await import("../feedlock");
    await createProtected("p", "Passw0rd!x");
    const key = await buy();
    expect((await attachRoute(post("/api/licenses/attach", { feed: "p", key }, "POST", { "x-feed-password": "Passw0rd!x" }))).status).toBe(200);
    return key;
  };

  test("the key on the feed sets a new password or removes it; another key, a bad body or a bad password is refused", async () => {
    const { protectedFeed } = await import("../feedlock");
    const key = await protectedWithLicense();
    const other = await buy("sub_2");
    for (const wrong of ["k".repeat(22), other, ""]) expect((await recover({ key: wrong, password: "N3wPassw0rd!" })).status).toBe(401);
    expect((await recover({ password: "N3wPassw0rd!" })).status).toBe(400);
    expect((await recover({ key, password: " padded " })).status).toBe(400);
    expect(await opens("Passw0rd!x")).toBe(true);

    expect((await recover({ key: ` ${key} `, password: "N3wPassw0rd!" })).status).toBe(204);
    expect(await opens("N3wPassw0rd!")).toBe(true);
    expect(await opens("Passw0rd!x")).toBe(false);

    expect((await recover({ key })).status).toBe(204);
    expect(await protectedFeed("p")).toBe(false);
    expect((await recover({ key, password: "N3wPassw0rd!" })).status).toBe(401); // nothing left to recover
  });

  test("a lapsed license's key removes the password but cannot set one; 404 where licenses are not sold", async () => {
    const { protectedFeed } = await import("../feedlock");
    const key = await protectedWithLicense();
    await webhookRoute(webhook([{ type: "refunded", providerRef: "sub_1" }]));
    expect((await recover({ key, password: "N3wPassw0rd!" })).status).toBe(402);
    expect((await recover({ key, password: "" })).status).toBe(204);
    expect(await protectedFeed("p")).toBe(false);
    vi.stubEnv("NOTEFEED_PAYMENT_PROVIDER", "");
    expect((await recover({ key, password: "N3wPassw0rd!" })).status).toBe(404);
  });
});

// An open feed gets a password later (ADR 0044, #248). Its name is all that protects it, so whoever has the name may set one, and so
// claim the feed; where licenses are sold, a password needs a licensed feed, as at creation.
describe.skipIf(!supported)("giving an open feed a password", () => {
  const putPassword = (body: unknown, headers: Record<string, string> = {}) =>
    dispatch(new Request(`https://notefeed.test${API_PREFIX}/feeds/o/password`, { method: "PUT", headers: { host: "notefeed.test", "content-type": "application/json", ...headers }, body: JSON.stringify(body) }), ["feeds", "o", "password"]);
  const opens = async (password: string) => {
    const { unlock } = await import("../feedlock");
    return unlock("o", password, "1.2.3.4").then(
      () => true,
      () => false,
    );
  };

  test("a licensed open feed takes one with no current password; afterwards the feed needs it, its read link does not", async () => {
    const { readIdOf } = await import("../feeds");
    await createNote("o", "# hi");
    expect((await putPassword({ password: "N3wPassw0rd!" })).status).toBe(402); // a password needs a license
    const key = await buy();
    expect((await attachRoute(post("/api/licenses/attach", { feed: "o", key }))).status).toBe(200);
    expect((await putPassword({ password: " padded " })).status).toBe(400);
    expect((await putPassword({ password: "N3wPassw0rd!" })).status).toBe(204);
    expect(await opens("N3wPassw0rd!")).toBe(true);
    const list = (headers: Record<string, string> = {}) => dispatch(new Request(`https://notefeed.test${API_PREFIX}/feeds/o/notes`, { headers: { host: "notefeed.test", ...headers } }), ["feeds", "o", "notes"]);
    expect((await list()).status).toBe(401);
    expect((await list({ "x-feed-password": "N3wPassw0rd!" })).status).toBe(200);
    const readId = (await readIdOf("o"))!;
    expect((await dispatch(new Request(`https://notefeed.test${API_PREFIX}/read/${readId}/notes`, { headers: { host: "notefeed.test" } }), ["read", readId, "notes"])).status).toBe(200);
    // Now it is a change, which needs the current password.
    expect((await putPassword({ password: "Other!pass1" })).status).toBe(401);
    expect((await putPassword({ password: "Other!pass1" }, { "x-feed-password": "N3wPassw0rd!" })).status).toBe(204);
  });

  test("without licenses on the instance, an open feed takes one too; a feed that does not exist is 404", async () => {
    vi.stubEnv("NOTEFEED_PAYMENT_PROVIDER", "");
    await createNote("o", "# hi");
    expect((await putPassword({ password: "N3wPassw0rd!" })).status).toBe(204);
    expect(await opens("N3wPassw0rd!")).toBe(true);
    const missing = await dispatch(new Request(`https://notefeed.test${API_PREFIX}/feeds/missing/password`, { method: "PUT", headers: { host: "notefeed.test", "content-type": "application/json" }, body: JSON.stringify({ password: "N3wPassw0rd!" }) }), ["feeds", "missing", "password"]);
    expect(missing.status).toBe(404);
  });

  test("the settings page's form sets it and unlocks this browser; a refusal goes back to that form", async () => {
    const { feedAccessRoute } = await import("./feedsession");
    await createNote("o", "# hi");
    const form = (fields: Record<string, string>) =>
      feedAccessRoute(new Request("https://notefeed.test/o/access", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://notefeed.test" }, body: new URLSearchParams({ action: "protect", ...fields }) }), "o");
    expect((await form({ next: "N3wPassw0rd!" })).headers.get("location")).toBe("/o/settings?form=protect&error=license_required");
    expect((await attachRoute(post("/api/licenses/attach", { feed: "o", key: await buy() }))).status).toBe(200);
    const ok = await form({ next: "N3wPassw0rd!" });
    expect(ok.headers.get("location")).toBe("/o/settings?saved=password-set#access");
    expect(ok.headers.getSetCookie()).toHaveLength(2);
    expect(await opens("N3wPassw0rd!")).toBe(true);
  });
});
