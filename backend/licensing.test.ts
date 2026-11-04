import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { config } from "./config";
import { AuthError, FeedExistsError, InvalidBodyError, LicenseRequiredError, NotFoundError, RateLimitedError, TooManyAttemptsError } from "./errors";
import { changePassword, createProtected, protectedFeed } from "./feedlock";
import { hasFeed, readIdOf, resetFeedsForTests } from "./feeds";
import { authWait, resetRateLimitsForTests } from "./limits";
import { countingKeys, hashKey } from "./licenseflow";
import { freeTier, isLicensed, licenses, licensingOn, releaseLicense, resetLicensesForTests } from "./licensing";
import { countNotes, createImageNote, createNote, listNotes } from "./notes";
import { storage } from "./storage";
import { createFeed, deleteFeed, postNote, postWithPictures, setLicense } from "./posting";
import { png as pngOf } from "./testimages";

// better-sqlite3 and kysely need Node 22 (the project's version); on an older Node the SQL tests are skipped.
const supported = Number(process.versions.node.split(".")[0]) >= 22;

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "notefeed-licensing-"));
  vi.stubEnv("DATA_DIR", dir);
  vi.stubEnv("NOTEFEED_STORAGE", "sqlite");
  vi.stubEnv("NOTEFEED_SECRET", "s".repeat(32));
  vi.stubEnv("NOTEFEED_RATE_LIMIT", "0");
  resetFeedsForTests();
  resetRateLimitsForTests();
});
afterEach(async () => {
  await resetLicensesForTests();
  vi.unstubAllEnvs();
  resetFeedsForTests();
  await rm(dir, { recursive: true, force: true });
});

const png = pngOf(1);
const text = (feed: string, body = "hi", password?: string, licenseKey?: string) =>
  postNote(feed, "ip", async () => ({ body: new TextEncoder().encode(body), mediaType: "text/markdown", password, licenseKey }), {});
// A key as the checkout hands it out (22 characters of base64url).
const KEY = "k".repeat(22);
const image = (feed: string, licenseKey?: string) => postNote(feed, "ip", async () => ({ body: png, mediaType: "image/png", licenseKey }), {});

describe.skipIf(!supported)("licensing (ADR 0029)", () => {
  test("with no payment provider everything is open and no cap is kept", async () => {
    vi.stubEnv("NOTEFEED_FREE_NOTE_CAP", "2");
    expect(licensingOn()).toBe(false);
    expect(await isLicensed("f")).toBe(true);
    for (let i = 0; i < 4; i++) await text("f", `n${i}`);
    await image("f");
    expect(await countNotes("f", "markdown")).toBe(4);
    expect(await countNotes("f", "image")).toBe(1);
    expect(await freeTier("f")).toBeNull();
    await text("p", "hi", "Passw0rd!x", "no such key"); // a key means nothing: not even looked at
    expect(await protectedFeed("p")).toBe(true);
  });

  describe("with a payment provider", () => {
    beforeEach(() => {
      vi.stubEnv("NOTEFEED_PAYMENT_PROVIDER", "fake");
      vi.stubEnv("NOTEFEED_FAKE_WEBHOOK_SECRET", "w");
      vi.stubEnv("NOTEFEED_FREE_NOTE_CAP", "3");
    });
    const license = async (feed: string, ref = "sub_1") => {
      await licenses().createLicense({ keyHash: `h-${ref}`, providerRef: ref, validUntil: null });
      expect(await licenses().attach(`h-${ref}`, feed)).toBe("attached");
    };

    test("a free feed drops its oldest note at the cap and never refuses a write", async () => {
      for (let i = 0; i < 5; i++) await createNote("f", `n${i}`, new Date(2026, 0, 1, 0, i));
      await text("f", "n5");
      expect(await countNotes("f", "markdown")).toBe(3);
    });

    test("a free feed counts every note against the cap, texts, images and the operator's marks, and drops the oldest of any kind", async () => {
      await createImageNote("f", png, {}, new Date(2026, 0, 1, 0, 0)); // from before a license lapsed
      await createNote("f", "taken down", new Date(2026, 0, 1, 0, 1));
      const [down] = await listNotes("f");
      await storage().takedownNotes("f", [{ id: down.id, ext: down.ext }], { date: down.date.getTime(), draft: false }, down.id);
      await createNote("f", "kept", new Date(2026, 0, 1, 0, 2));
      expect(await freeTier("f")).toEqual({ notes: 3, cap: 3 });
      await text("f", "new");
      expect((await listNotes("f")).map((n) => n.title || n.type)).toEqual(["new", "kept", "application/x-notefeed-removed"]);
    });

    test("a free feed's usage counts its text notes against the cap; a licensed feed has none", async () => {
      await text("f", "first");
      await text("f", "second");
      expect(await freeTier("f")).toEqual({ notes: 2, cap: 3 });
      await license("f");
      expect(await freeTier("f")).toBeNull();
    });

    test("a reserved feed is never on the free tier: it keeps every note, takes images, shows no cap (#242)", async () => {
      vi.stubEnv("NOTEFEED_RESERVED_FEEDS", "releases");
      vi.stubEnv("NOTEFEED_RESERVED_PASSWORD", "Reserved-pw1");
      resetFeedsForTests();
      expect(await readIdOf("releases")).toBe("releases"); // made at the first look, as at start-up
      for (let i = 0; i < 5; i++) {
        await postNote("releases", "ip", async () => ({ body: new TextEncoder().encode(`n${i}`), mediaType: "text/markdown" }), { password: "Reserved-pw1" });
        await text("f", `n${i}`);
      }
      expect(await countNotes("releases", "markdown")).toBe(5);
      expect(await countNotes("f", "markdown")).toBe(3);
      await postNote("releases", "ip", async () => ({ body: png, mediaType: "image/png" }), { password: "Reserved-pw1" });
      expect(await countNotes("releases", "image")).toBe(1);
      await expect(image("f")).rejects.toBeInstanceOf(LicenseRequiredError);
      expect(await freeTier("releases")).toBeNull();
      expect(await freeTier("f")).toEqual({ notes: 3, cap: 3 });
    });

    test("a licensed feed keeps every note", async () => {
      await text("f", "first");
      await license("f");
      for (let i = 0; i < 5; i++) await text("f", `n${i}`);
      expect(await countNotes("f", "markdown")).toBe(6);
    });

    test("deleting a feed frees its license to be entered on another feed", async () => {
      await text("f", "first");
      await license("f");
      await deleteFeed("f", "ip", {});
      expect(await isLicensed("f")).toBe(false);
      expect((await licenses().byProviderRef("sub_1"))?.feed).toBeNull();
      await text("g", "first");
      expect(await licenses().attach("h-sub_1", "g")).toBe("attached");
      expect(await isLicensed("g")).toBe(true);
    });

    test("an image needs a license, as a single post and with a text", async () => {
      await text("f", "first");
      await expect(image("f")).rejects.toBeInstanceOf(LicenseRequiredError);
      await expect(postWithPictures("f", "ip", async () => ({ text: "x", pictures: [{ name: "a.png", body: png, mediaType: "image/png" }] }), {})).rejects.toBeInstanceOf(LicenseRequiredError);
      await license("f");
      await image("f");
      expect(await countNotes("f", "image")).toBe(1);
    });

    test("a lapsed license is a free feed again: no new image, the stored one stays", async () => {
      await text("f", "first");
      await license("f");
      await image("f");
      await licenses().update("sub_1", { status: "lapsed" });
      expect(await isLicensed("f")).toBe(false);
      await expect(image("f")).rejects.toBeInstanceOf(LicenseRequiredError);
      expect(await countNotes("f", "image")).toBe(1);
    });

    test("a password at creation needs a license, so a new feed cannot have one", async () => {
      await expect(text("new", "hi", "Passw0rd!x")).rejects.toBeInstanceOf(LicenseRequiredError);
      expect(await protectedFeed("new")).toBe(false);
    });

    test("the post that creates a protected feed brings the license key, and the feed is licensed (issue #193)", async () => {
      await licenses().createLicense({ keyHash: hashKey(KEY), providerRef: "sub_1", validUntil: null });
      await text("new", "hi", "Passw0rd!x", ` ${KEY} `);
      expect(await protectedFeed("new")).toBe(true);
      expect(await isLicensed("new")).toBe(true);
      expect(await countNotes("new", "markdown")).toBe(1);
      // With pictures too, and the key moves the license, as entering it in the settings does.
      await postWithPictures("pics", "ip", async () => ({ text: "x", pictures: [{ name: "a.png", body: png, mediaType: "image/png" }], password: "Passw0rd!x", licenseKey: KEY }), {});
      expect(await protectedFeed("pics")).toBe(true);
      expect(await isLicensed("pics")).toBe(true);
      expect(await isLicensed("new")).toBe(false);
      expect(await countNotes("pics", "image")).toBe(1);
    });

    test("a key that is none, or of a lapsed license, creates nothing, with a password or without", async () => {
      await expect(text("new", "hi", "Passw0rd!x", "x".repeat(22))).rejects.toBeInstanceOf(InvalidBodyError);
      await expect(text("new", "hi", "Passw0rd!x", "too short")).rejects.toBeInstanceOf(InvalidBodyError);
      await licenses().createLicense({ keyHash: hashKey(KEY), providerRef: "sub_1", validUntil: null });
      await licenses().update("sub_1", { status: "lapsed" });
      await expect(text("new", "hi", "Passw0rd!x", KEY)).rejects.toBeInstanceOf(LicenseRequiredError);
      await licenses().update("sub_1", { status: "active", validUntil: Date.now() - 1000 });
      await expect(text("new", "hi", "Passw0rd!x", KEY)).rejects.toBeInstanceOf(LicenseRequiredError);
      await expect(text("new", "hi", undefined, KEY)).rejects.toBeInstanceOf(LicenseRequiredError);
      await expect(text("new", "hi", undefined, "x".repeat(22))).rejects.toBeInstanceOf(InvalidBodyError);
      await expect(image("new", "x".repeat(22))).rejects.toBeInstanceOf(InvalidBodyError);
      expect(await hasFeed("new")).toBe(false);
    });

    test("the post that creates an open feed can bring the key too: a license needs no password (#247)", async () => {
      await licenses().createLicense({ keyHash: hashKey(KEY), providerRef: "sub_1", validUntil: null });
      await text("open", "hi", undefined, ` ${KEY} `);
      expect(await protectedFeed("open")).toBe(false);
      expect(await isLicensed("open")).toBe(true);
      // A picture as the first post, with the key: judged by the key, and the feed is licensed (the key moves the license).
      await image("pics", KEY);
      expect(await isLicensed("pics")).toBe(true);
      expect(await isLicensed("open")).toBe(false);
      expect(await countNotes("pics", "image")).toBe(1);
      await postWithPictures("both", "ip", async () => ({ text: "x ![](a.png)", pictures: [{ name: "a.png", body: png, mediaType: "image/png" }], licenseKey: KEY }), {});
      expect(await isLicensed("both")).toBe(true);
      // On a feed that exists, a key on a post is not used: the license stays where it is.
      await text("both", "again", undefined, KEY);
      await text("pics", "again", undefined, KEY);
      expect(await isLicensed("pics")).toBe(false);
      expect((await licenses().byKeyHash(hashKey(KEY)))?.feed).toBe("both");
    });

    test("setLicense puts a key's license on an existing feed, open or protected, and takes it off (#247)", async () => {
      await licenses().createLicense({ keyHash: hashKey(KEY), providerRef: "sub_1", validUntil: null });
      await text("open", "hi");
      await setLicense("open", "ip", KEY, {});
      expect(await isLicensed("open")).toBe(true);
      await expect(setLicense("open", "ip", "y".repeat(22), {})).rejects.toBeInstanceOf(InvalidBodyError); // a key that is none
      await createProtected("locked", "Passw0rd!x"); // as before licensing: protected, no license
      await expect(setLicense("locked", "ip", KEY, {})).rejects.toBeInstanceOf(AuthError);
      await setLicense("locked", "ip", KEY, { password: "Passw0rd!x" });
      expect(await isLicensed("locked")).toBe(true);
      expect(await isLicensed("open")).toBe(false);
      await setLicense("locked", "ip", null, { password: "Passw0rd!x" });
      expect(await isLicensed("locked")).toBe(false);
      await setLicense("locked", "ip", null, { password: "Passw0rd!x" }); // nothing to take off: the same answer
      await expect(setLicense("nothing", "ip", KEY, {})).rejects.toBeInstanceOf(NotFoundError);
      await licenses().update("sub_1", { status: "lapsed" });
      await expect(setLicense("open", "ip", KEY, {})).rejects.toBeInstanceOf(LicenseRequiredError);
    });

    test("wrong keys count as failed attempts, as wrong passwords do: over the limit no key is looked at (#247)", async () => {
      vi.stubEnv("NOTEFEED_RATE_LIMIT", "2");
      resetRateLimitsForTests();
      await licenses().createLicense({ keyHash: hashKey(KEY), providerRef: "sub_1", validUntil: null });
      await createNote("open", "hi");
      await expect(setLicense("open", "ip", "y".repeat(22), {})).rejects.toBeInstanceOf(InvalidBodyError);
      expect(authWait("ip")).toBeNull();
      await expect(text("new", "hi", undefined, "z".repeat(22))).rejects.toBeInstanceOf(InvalidBodyError);
      expect(authWait("ip")).toBeGreaterThan(0); // two failed: the third key from there is not even looked at
      await expect(countingKeys("ip", async () => "never")).rejects.toBeInstanceOf(TooManyAttemptsError);
      await setLicense("open", "other-ip", KEY, {});
      expect(await isLicensed("open")).toBe(true);
      expect(authWait("other-ip")).toBeNull(); // a right key costs nothing
    });

    test("createFeed: a feed without a note needs a license key here; it is made protected or open, licensed, and only once (#295)", async () => {
      await licenses().createLicense({ keyHash: hashKey(KEY), providerRef: "sub_1", validUntil: null });
      await expect(createFeed("p", "ip", { password: "Passw0rd!x" })).rejects.toBeInstanceOf(LicenseRequiredError);
      await expect(createFeed("p", "ip", { password: "Passw0rd!x", licenseKey: "y".repeat(22) })).rejects.toBeInstanceOf(InvalidBodyError);
      await expect(createFeed("p", "ip", { password: " padded ", licenseKey: KEY })).rejects.toBeInstanceOf(InvalidBodyError);
      expect(await hasFeed("p")).toBe(false);
      await createFeed("p", "ip", { password: "Passw0rd!x", licenseKey: ` ${KEY} `, readId: "my-read-id" });
      expect([await hasFeed("p"), await protectedFeed("p"), await isLicensed("p"), await readIdOf("p"), await countNotes("p")]).toEqual([true, true, true, "my-read-id", 0]);
      await expect(createFeed("p", "ip", { licenseKey: KEY })).rejects.toBeInstanceOf(FeedExistsError);
      await licenses().createLicense({ keyHash: hashKey("o".repeat(22)), providerRef: "sub_2", validUntil: null });
      await createFeed("open", "ip", { licenseKey: "o".repeat(22) });
      expect([await protectedFeed("open"), await isLicensed("open")]).toEqual([false, true]);
    });

    test("writes to a licensed feed skip the per-IP post limit; a free or lapsed feed's still count (ADR 0046, #123)", async () => {
      vi.stubEnv("NOTEFEED_RATE_LIMIT", "2");
      resetRateLimitsForTests();
      await createNote("paid", "first");
      await license("paid");
      for (let i = 0; i < 5; i++) await text("paid", `burst ${i}`);
      await text("free", "one");
      await text("free", "two");
      await expect(text("free", "three")).rejects.toBeInstanceOf(RateLimitedError);
      await licenses().update("sub_1", { status: "lapsed" });
      await expect(text("paid", "after")).rejects.toBeInstanceOf(RateLimitedError);
    });

    test("an existing password keeps protecting a lapsed feed, but it cannot be changed", async () => {
      await createProtected("f", "Passw0rd!x");
      await license("f");
      await licenses().update("sub_1", { status: "lapsed" });
      await expect(changePassword("f", "Passw0rd!x", "Passw0rd!y", "ip")).rejects.toBeInstanceOf(LicenseRequiredError);
      expect(await protectedFeed("f")).toBe(true);
      await licenses().update("sub_1", { status: "active" });
      await changePassword("f", "Passw0rd!x", "Passw0rd!y", "ip");
    });
  });

  test("the licenses are a file of their own, so any storage backend can sell them", async () => {
    vi.stubEnv("NOTEFEED_STORAGE", "fs");
    vi.stubEnv("NOTEFEED_PAYMENT_PROVIDER", "fake");
    vi.stubEnv("NOTEFEED_FAKE_WEBHOOK_SECRET", "w");
    expect(() => config.validateStorage()).not.toThrow();
    expect(config.licenseDb()).toBe(`${dir}/licenses.db`);
    vi.stubEnv("NOTEFEED_LICENSE_DB", "file:/var/lib/licenses.db");
    expect(config.licenseDb()).toBe("/var/lib/licenses.db");
    vi.stubEnv("NOTEFEED_LICENSE_DB", "");
    await licenses().createLicense({ keyHash: "h1", providerRef: "sub_1", validUntil: null });
    await licenses().attach("h1", "f");
    expect(await isLicensed("f")).toBe(true);
    await releaseLicense("f"); // the feed was deleted
    expect(await isLicensed("f")).toBe(false);
    expect((await licenses().byKeyHash("h1"))?.feed).toBeNull();
  });

  test("a payment provider is checked at start: a known one, with what it needs", () => {
    vi.stubEnv("NOTEFEED_PAYMENT_PROVIDER", "paypal");
    expect(() => config.validateStorage()).toThrow(/not a payment provider/);
    vi.stubEnv("NOTEFEED_PAYMENT_PROVIDER", "creem");
    expect(() => config.validateStorage()).toThrow(/needs NOTEFEED_CREEM_API_KEY, NOTEFEED_CREEM_PRODUCT_ID, NOTEFEED_CREEM_WEBHOOK_SECRET, PUBLIC_URL/);
  });
});
