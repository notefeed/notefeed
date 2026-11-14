// What a license changes (ADR 0029), on the account (ADR 0061, #391): the free tier, images, passwords, and which feeds it covers.
import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { licensedAccount, stubLicensing } from "./accounts/license.testkit";
import { putSubscription, updateSubscription } from "./accounts/subscriptions";
import { InvalidBodyError, LicenseRequiredError, NotFoundError, RateLimitedError } from "./errors";
import { changePassword, coveredFeeds, ownNewFeed, resetOwnersForTests, setCovered } from "./feedlock";
import { ensureFeed, resetFeedsForTests } from "./feeds";
import { resetRateLimitsForTests } from "./limits";
import { changeUnits, licenseOf } from "./licenseflow";
import { freeTier, isLicensed, licensedFeedsOf, licensingOn } from "./licensing";
import { countNotes, createNote } from "./notes";
import { fake } from "./payments/fake";
import { createFeed, postNote, setFeedCovered, updateFeed } from "./posting";
import { png as pngOf } from "./testimages";

const supported = Number(process.versions.node.split(".")[0]) >= 22;

let dir = "";
beforeEach(async () => {
  dir = process.env.DATA_DIR!;
  vi.stubEnv("NOTEFEED_STORAGE", "sqlite");
  vi.stubEnv("NOTEFEED_SECRET", "s".repeat(32));
  vi.stubEnv("NOTEFEED_RATE_LIMIT", "0");
  resetFeedsForTests();
  resetRateLimitsForTests();
  resetOwnersForTests();
  fake.changes.length = 0;
  fake.cancelled.length = 0;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  resetFeedsForTests();
  await rm(dir, { recursive: true, force: true });
});

const png = pngOf(1);
const text = (feed: string, account?: string, password?: string) =>
  postNote(feed, "ip", async () => ({ body: new TextEncoder().encode("hi"), mediaType: "text/markdown", password }), { ...(account ? { account } : {}) });
const image = (feed: string, account?: string) =>
  postNote(feed, "ip", async () => ({ body: png, mediaType: "image/png" }), { ...(account ? { account } : {}) });

describe.skipIf(!supported)("licensing on the account (ADR 0061)", () => {
  test("with no payment provider everything is open and no cap is kept", async () => {
    expect(licensingOn()).toBe(false);
    expect(await isLicensed("any")).toBe(true);
    expect(await freeTier("any")).toBeNull();
  });

  describe("with a payment provider", () => {
    beforeEach(async () => {
      await stubLicensing();
      vi.stubEnv("NOTEFEED_FREE_NOTE_CAP", "3");
    });

    test("a free feed drops its oldest note at the cap and never refuses a write", async () => {
      for (let i = 0; i < 5; i++) await text("free");
      expect(await countNotes("free")).toBe(3);
      expect(await freeTier("free")).toEqual({ notes: 3, cap: 3 });
    });

    test("a feed under its owner's license keeps every note and shows no cap", async () => {
      const { userId } = await licensedAccount(1, ["paid"]);
      for (let i = 0; i < 5; i++) await text("paid", userId);
      expect(await countNotes("paid")).toBe(5);
      expect(await freeTier("paid")).toBeNull();
    });

    test("the license covers as many feeds as its units, the first ones put under it; more are refused", async () => {
      const { userId } = await licensedAccount(2, ["a", "b"]);
      await ensureFeed("c");
      await ownNewFeed("c", userId);
      await expect(setCovered("c", userId, true, 2)).rejects.toBeInstanceOf(LicenseRequiredError);
      expect(await licensedFeedsOf(userId)).toEqual(["a", "b"]);
      await setCovered("a", userId, false, 2);
      await setCovered("c", userId, true, 2);
      expect(await licensedFeedsOf(userId)).toEqual(["b", "c"]);
    });

    test("only the owner puts a feed under its license; a feed without one can't be", async () => {
      const { userId } = await licensedAccount(1);
      const other = await licensedAccount(1);
      await ensureFeed("mine");
      await ownNewFeed("mine", userId);
      await expect(setFeedCovered("mine", "ip", true, { account: other.userId })).rejects.toMatchObject({ code: "owner_only" });
      await setFeedCovered("mine", "ip", true, { account: userId });
      expect(await isLicensed("mine")).toBe(true);
      await createNote("nobodys", "# x");
      await expect(setFeedCovered("nobodys", "ip", true, { account: userId })).rejects.toMatchObject({ code: "owner_only" });
    });

    test("a lapsed subscription puts its feeds back on the free tier; the later ones first when units shrink", async () => {
      const { userId } = await licensedAccount(2, ["first", "second"]);
      const [sub] = (await licenseOf(userId)).subscriptions;
      await updateSubscription(sub.id, { units: 1 });
      expect(await isLicensed("first")).toBe(true);
      expect(await isLicensed("second")).toBe(false);
      await updateSubscription(sub.id, { status: "lapsed" });
      expect(await isLicensed("first")).toBe(false);
      expect((await licenseOf(userId)).covered).toEqual(["first", "second"]); // still under it, waiting for a license again
    });

    test("subscriptions add up, and one past its end counts for nothing", async () => {
      const { userId } = await licensedAccount(1, ["a"]);
      await putSubscription({ providerRef: "sub_y", account: userId, customerRef: null, period: "year", units: 2, validUntil: Date.now() + 86_400_000 });
      await ensureFeed("b");
      await ownNewFeed("b", userId);
      await setCovered("b", userId, true, 3);
      expect(await licensedFeedsOf(userId)).toEqual(["a", "b"]);
      await updateSubscription("sub_y", { validUntil: Date.now() - 1 });
      expect(await licensedFeedsOf(userId)).toEqual(["a"]);
    });

    test("an image needs a licensed feed; a new feed with one needs room in the posting account's license, and goes under it", async () => {
      await text("free");
      await expect(image("free")).rejects.toBeInstanceOf(LicenseRequiredError);
      await expect(image("brand-new")).rejects.toBeInstanceOf(LicenseRequiredError);
      const { userId } = await licensedAccount(1);
      await image("pictures", userId);
      expect(await coveredFeeds(userId)).toEqual(["pictures"]);
      await expect(image("more-pictures", userId)).rejects.toBeInstanceOf(LicenseRequiredError); // its one unit is taken
    });

    test("a password at creation needs room in the account's license, and the protected feed goes under it", async () => {
      await expect(text("p", undefined, "a-password")).rejects.toBeInstanceOf(LicenseRequiredError);
      const { userId } = await licensedAccount(1);
      await text("p", userId, "a-password");
      expect(await isLicensed("p")).toBe(true);
      expect(await coveredFeeds(userId)).toEqual(["p"]);
    });

    test("createFeed without a note needs an account with room; the feed is its own and under its license", async () => {
      await expect(createFeed("empty", "ip", {})).rejects.toBeInstanceOf(LicenseRequiredError);
      const { userId } = await licensedAccount(1);
      await createFeed("empty", "ip", {}, userId);
      expect(await licensedFeedsOf(userId)).toEqual(["empty"]);
    });

    test("a reserved feed is never on the free tier", async () => {
      vi.stubEnv("NOTEFEED_RESERVED_FEEDS", "news");
      expect(await isLicensed("news")).toBe(true);
    });

    test("a renamed feed keeps its place under the license", async () => {
      const { userId } = await licensedAccount(1, ["old"]);
      await text("old", userId);
      await updateFeed("old", "ip", async () => ({ title: "", description: "", name: "new" }), { account: userId });
      expect(await licensedFeedsOf(userId)).toEqual(["new"]);
    });

    test("writes to a licensed feed skip the per-IP post limit; a free feed's still count (ADR 0046)", async () => {
      vi.stubEnv("NOTEFEED_RATE_LIMIT", "2");
      const { userId } = await licensedAccount(1, ["paid"]);
      for (let i = 0; i < 4; i++) await text("paid", userId);
      await text("free");
      await text("free");
      await expect(text("free")).rejects.toBeInstanceOf(RateLimitedError);
    });

    test("a lapsed feed keeps its password, which can't be changed then", async () => {
      const { userId } = await licensedAccount(1);
      await text("p", userId, "a-password");
      const [sub] = (await licenseOf(userId)).subscriptions;
      await updateSubscription(sub.id, { status: "lapsed" });
      await expect(changePassword("p", "a-password", "another-password", "ip")).rejects.toMatchObject({ code: "owner_only" });
      expect(await freeTier("p")).not.toBeNull();
    });

    test("units are raised and lowered at the provider, not below the feeds under the license", async () => {
      const { userId } = await licensedAccount(2, ["a", "b"]);
      const [sub] = (await licenseOf(userId)).subscriptions;
      await expect(changeUnits(userId, sub.id, 1)).rejects.toBeInstanceOf(InvalidBodyError);
      await changeUnits(userId, sub.id, 3);
      expect(fake.changes.at(-1)).toEqual({ providerRef: sub.id, units: 3, how: "raise" });
      await setCovered("b", userId, false, 3);
      await changeUnits(userId, sub.id, 1);
      expect(fake.changes.at(-1)).toEqual({ providerRef: sub.id, units: 1, how: "lower" });
      expect((await licenseOf(userId)).units).toBe(1);
      const other = await licensedAccount(1);
      await expect(changeUnits(other.userId, sub.id, 2)).rejects.toBeInstanceOf(NotFoundError);
      await expect(changeUnits(userId, sub.id, 0)).rejects.toBeInstanceOf(InvalidBodyError);
    });
  });
});
