import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { migrateAccounts } from "./auth";
import { createAccount } from "./numbers";
import { activeUnits, putSubscription, subscriptionByRef, subscriptionsOf, updateSubscription } from "./subscriptions";

const DAY = 86_400_000;
beforeEach(async () => {
  vi.stubEnv("NOTEFEED_SECRET", "test-secret-".padEnd(32, "x"));
  vi.stubEnv("NOTEFEED_PASSWORD", "");
  vi.stubEnv("PUBLIC_URL", "http://localhost:3000");
  vi.stubEnv("NOTEFEED_ACCOUNTS", "open");
  await migrateAccounts();
});
afterEach(() => vi.unstubAllEnvs());

test("an account's active units are the sum of its subscriptions that are paid for now", async () => {
  const { userId } = await createAccount();
  const now = Date.now();
  await putSubscription({ providerRef: "sub_m", account: userId, customerRef: "cust_1", period: "month", units: 2, validUntil: now + DAY });
  await putSubscription({ providerRef: "sub_y", account: userId, customerRef: "cust_1", period: "year", units: 3, validUntil: now + 300 * DAY });
  await putSubscription({ providerRef: "sub_old", account: userId, customerRef: "cust_1", period: "month", units: 5, validUntil: now - DAY });
  expect(await activeUnits(userId, now)).toBe(5);
  await updateSubscription("sub_y", { status: "lapsed" });
  expect(await activeUnits(userId, now)).toBe(2);
  expect((await subscriptionsOf(userId)).map((s) => s.providerRef).sort()).toEqual(["sub_m", "sub_old", "sub_y"]);
});

test("the same subscription twice is one (a webhook delivered twice), keeping its account", async () => {
  const { userId } = await createAccount();
  await putSubscription({ providerRef: "sub_1", account: userId, customerRef: null, period: "month", units: 1, validUntil: null });
  await putSubscription({ providerRef: "sub_1", account: userId, customerRef: null, period: "month", units: 1, validUntil: null });
  expect(await subscriptionsOf(userId)).toHaveLength(1);
  expect(await activeUnits(userId)).toBe(1); // no date: active until the provider says otherwise
  expect((await subscriptionByRef("sub_1"))?.account).toBe(userId);
});

test("units change; an unknown reference is false", async () => {
  const { userId } = await createAccount();
  await putSubscription({ providerRef: "sub_1", account: userId, customerRef: null, period: "month", units: 1, validUntil: null });
  expect(await updateSubscription("sub_1", { units: 4 })).toBe(true);
  expect(await activeUnits(userId)).toBe(4);
  expect(await updateSubscription("nope", { units: 4 })).toBe(false);
});
