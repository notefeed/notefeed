// The account's license over the API and the provider's webhook (ADR 0061, #391), with the fake provider.
import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { stubLicensing } from "../accounts/license.testkit";
import { createAccount, signInWithNumber } from "../accounts/numbers";
import { subscriptionByRef } from "../accounts/subscriptions";
import { resetOwnersForTests } from "../feedlock";
import { resetFeedsForTests } from "../feeds";
import { resetRateLimitsForTests } from "../limits";
import { isLicensed } from "../licensing";
import { fake, fakeSignature } from "../payments/fake";
import { inRequest } from "../requestscope";
import { API_PREFIX, dispatch } from "./api";
import { webhookRoute } from "./licenses";

const supported = Number(process.versions.node.split(".")[0]) >= 22;
const BASE = "http://localhost:3000";
const SAME = { host: "localhost:3000", origin: BASE };

let dir = "";
beforeEach(async () => {
  dir = process.env.DATA_DIR!;
  vi.stubEnv("NOTEFEED_STORAGE", "sqlite");
  vi.stubEnv("NOTEFEED_SECRET", "s".repeat(32));
  vi.stubEnv("NOTEFEED_RATE_LIMIT", "0");
  vi.stubEnv("PUBLIC_URL", BASE);
  resetFeedsForTests();
  resetRateLimitsForTests();
  resetOwnersForTests();
  await stubLicensing();
  fake.checkouts.length = 0;
  fake.cancelled.length = 0;
  fake.subscriptions.clear();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  resetFeedsForTests();
  await rm(dir, { recursive: true, force: true });
});

async function signedIn() {
  const a = await createAccount();
  const cookies = await signInWithNumber(a.number, a.recoveryKey, new Headers(SAME));
  return { ...a, h: { ...SAME, cookie: cookies.map((c) => c.split(";")[0]).join("; ") } };
}
function call(method: string, path: string, headers: Record<string, string> = {}, body?: unknown) {
  const url = new URL(API_PREFIX + path, BASE);
  const segments = url.pathname
    .slice(API_PREFIX.length + 1)
    .split("/")
    .map(decodeURIComponent);
  const init: RequestInit = { method, headers: { host: "localhost:3000", ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return inRequest({ id: "t" }, () => dispatch(new Request(url, init), segments));
}
const webhook = (events: unknown[]) => {
  const raw = JSON.stringify(events);
  return webhookRoute(new Request(`${BASE}/api/licenses/webhook`, { method: "POST", headers: { "x-fake-signature": fakeSignature("whsec", raw) }, body: raw }));
};
const started = (account: string, ref = "sub_1", units = 2) => ({
  type: "started",
  providerRef: ref,
  account,
  customerRef: "cust_1",
  period: "month",
  units,
  validUntil: Date.now() + 30 * 86_400_000,
});

describe.skipIf(!supported)("the account's license", () => {
  test("buying: a checkout for the account's units; the webhook puts the subscription on the account", async () => {
    const ann = await signedIn();
    const res = await call("POST", "/account/license/checkout", ann.h, { period: "year", units: 3 });
    expect(res.status).toBe(200);
    expect((await res.json()).url).toMatch(/\/account\?bought=1&checkout_id=fake_/);
    expect(fake.checkouts.at(-1)).toEqual({ period: "year", units: 3, account: ann.userId });
    expect((await webhook([started(ann.userId, "sub_1", 3)])).status).toBe(200);
    const license = await (await call("GET", "/account/license", ann.h)).json();
    expect(license).toMatchObject({ units: 3, covered: [], licensed: [] });
    expect(license.subscriptions).toEqual([expect.objectContaining({ id: "sub_1", units: 3, period: "month", active: true })]);
  });

  test("units outside 1 to 100, or a period not sold, are refused; buying needs an account", async () => {
    const ann = await signedIn();
    expect((await call("POST", "/account/license/checkout", ann.h, { units: 0 })).status).toBe(400);
    expect((await call("POST", "/account/license/checkout", ann.h, { units: 101 })).status).toBe(400);
    expect((await call("POST", "/account/license/checkout", ann.h, { period: "week" })).status).toBe(400);
    expect((await call("POST", "/account/license/checkout", {}, {})).status).toBe(401);
  });

  test("the owner puts a feed under the license and takes it off; past the units is 402", async () => {
    const ann = await signedIn();
    await webhook([started(ann.userId, "sub_1", 1)]);
    expect((await call("POST", "/feeds/a", ann.h, {})).status).toBe(201); // made under the license
    expect(await isLicensed("a")).toBe(true);
    expect((await call("POST", "/feeds/b", ann.h, {})).status).toBe(402); // no unit left for a new feed
    expect((await call("DELETE", "/feeds/a/license", ann.h)).status).toBe(200);
    expect(await isLicensed("a")).toBe(false);
    expect((await call("PUT", "/feeds/a/license", ann.h)).status).toBe(200);
    expect(await isLicensed("a")).toBe(true);
    const bob = await signedIn();
    expect((await call("DELETE", "/feeds/a/license", bob.h)).status).toBe(403);
  });

  test("raising and lowering a subscription's units; not below the feeds under it", async () => {
    const ann = await signedIn();
    await webhook([started(ann.userId, "sub_1", 1)]);
    await call("POST", "/feeds/a", ann.h, {});
    expect((await call("PUT", "/account/license/subscriptions/sub_1", ann.h, { units: 3 })).status).toBe(204);
    expect(fake.changes.at(-1)).toMatchObject({ providerRef: "sub_1", units: 3, how: "raise" });
    expect((await (await call("GET", "/account/license", ann.h)).json()).units).toBe(3);
    expect((await call("PUT", "/account/license/subscriptions/sub_1", ann.h, { units: 0 })).status).toBe(400);
    const bob = await signedIn();
    expect((await call("PUT", "/account/license/subscriptions/sub_1", bob.h, { units: 2 })).status).toBe(404);
  });

  test("the portal opens for the account that bought only", async () => {
    const ann = await signedIn();
    expect((await call("GET", "/account/license/portal", ann.h)).status).toBe(404);
    await webhook([started(ann.userId)]);
    expect(await (await call("GET", "/account/license/portal", ann.h)).json()).toEqual({ url: "https://fake.invalid/portal/cust_1" });
  });

  test("cancelling keeps it to the end of the period; ending lapses it; a renewal restores it, with new units", async () => {
    const ann = await signedIn();
    await webhook([started(ann.userId)]);
    await webhook([{ type: "cancelled", providerRef: "sub_1", validUntil: Date.now() + 1000 }]);
    expect((await subscriptionByRef("sub_1"))?.status).toBe("active");
    await webhook([{ type: "ended", providerRef: "sub_1", periodEnd: null }]);
    expect((await subscriptionByRef("sub_1"))?.status).toBe("lapsed");
    await webhook([{ type: "renewed", providerRef: "sub_1", validUntil: Date.now() + 86_400_000, units: 5 }]);
    expect(await subscriptionByRef("sub_1")).toMatchObject({ status: "active", units: 5 });
  });

  test("a full refund lapses it and ends it at the provider; a partial one reads the units again", async () => {
    const ann = await signedIn();
    await webhook([started(ann.userId, "sub_1", 3)]);
    fake.subscriptions.set("sub_1", { units: 2, active: true, validUntil: null, customerRef: "cust_1", period: "month" });
    await webhook([{ type: "refunded", providerRef: "sub_1", full: false }]);
    expect((await subscriptionByRef("sub_1"))?.units).toBe(2);
    expect(fake.cancelled).toEqual([]);
    await webhook([{ type: "refunded", providerRef: "sub_1", full: true }]);
    expect((await subscriptionByRef("sub_1"))?.status).toBe("lapsed");
    expect(fake.cancelled).toEqual(["sub_1"]);
  });

  test("a bad signature is 400, and the same event twice does no harm", async () => {
    const ann = await signedIn();
    const raw = JSON.stringify([started(ann.userId)]);
    expect(
      (await webhookRoute(new Request(`${BASE}/api/licenses/webhook`, { method: "POST", headers: { "x-fake-signature": "nope" }, body: raw }))).status,
    ).toBe(400);
    await webhook([started(ann.userId)]);
    await webhook([started(ann.userId)]);
    expect((await (await call("GET", "/account/license", ann.h)).json()).subscriptions).toHaveLength(1);
  });

  test("deleting the account ends its subscriptions at the provider", async () => {
    const ann = await signedIn();
    await webhook([started(ann.userId)]);
    const { deleteAccountWithFeeds } = await import("../posting");
    await deleteAccountWithFeeds(ann.userId);
    expect(fake.cancelled).toEqual(["sub_1"]);
    expect(await subscriptionByRef("sub_1")).toBeNull();
  });
});

describe.skipIf(!supported)("what licenses there are, through the API", () => {
  test("the plans, the license page and the account page to manage one", async () => {
    const res = await call("GET", "/licenses");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ buy_url: `${BASE}/license`, manage_url: `${BASE}/account` });
    expect(body.manage).toMatch(/belongs to an account/);
  });

  test("an instance that sells no licenses answers 404, here and for the account's license", async () => {
    vi.stubEnv("NOTEFEED_PAYMENT_PROVIDER", "");
    expect((await call("GET", "/licenses")).status).toBe(404);
    const ann = await signedIn();
    expect((await call("GET", "/account/license", ann.h)).status).toBe(404);
  });
});
