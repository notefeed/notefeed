import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { config } from "./config";
import { LicenseRequiredError } from "./errors";
import { changePassword, createProtected, protectedFeed } from "./feedlock";
import { resetFeedsForTests } from "./feeds";
import { resetRateLimitsForTests } from "./limits";
import { isLicensed, licenses, licensingOn } from "./licensing";
import { countNotes, createNote } from "./notes";
import { postNote, postWithPictures } from "./posting";

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
  vi.unstubAllEnvs();
  resetFeedsForTests();
  await rm(dir, { recursive: true, force: true });
});

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const text = (feed: string, body = "hi", password?: string) => postNote(feed, "ip", async () => ({ body: new TextEncoder().encode(body), mediaType: "text/markdown", password }), {});
const image = (feed: string) => postNote(feed, "ip", async () => ({ body: png, mediaType: "image/png" }), {});

describe.skipIf(!supported)("licensing (ADR 0029)", () => {
  test("with no payment provider everything is open and no cap is kept", async () => {
    vi.stubEnv("NOTEFEED_FREE_NOTE_CAP", "2");
    expect(licensingOn()).toBe(false);
    expect(await isLicensed("f")).toBe(true);
    for (let i = 0; i < 4; i++) await text("f", `n${i}`);
    await image("f");
    expect(await countNotes("f", "markdown")).toBe(4);
    expect(await countNotes("f", "image")).toBe(1);
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

    test("a licensed feed keeps every note", async () => {
      await text("f", "first");
      await license("f");
      for (let i = 0; i < 5; i++) await text("f", `n${i}`);
      expect(await countNotes("f", "markdown")).toBe(6);
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

  test("a payment provider on the file system backend is refused at start", () => {
    vi.stubEnv("NOTEFEED_STORAGE", "fs");
    vi.stubEnv("NOTEFEED_PAYMENT_PROVIDER", "fake");
    vi.stubEnv("NOTEFEED_FAKE_WEBHOOK_SECRET", "w");
    expect(() => config.validateStorage()).toThrow(/NOTEFEED_PAYMENT_PROVIDER needs NOTEFEED_STORAGE/);
  });

  test("a payment provider is checked at start: a known one, with what it needs", () => {
    vi.stubEnv("NOTEFEED_PAYMENT_PROVIDER", "paypal");
    expect(() => config.validateStorage()).toThrow(/not a payment provider/);
    vi.stubEnv("NOTEFEED_PAYMENT_PROVIDER", "creem");
    expect(() => config.validateStorage()).toThrow(/needs NOTEFEED_CREEM_API_KEY, NOTEFEED_CREEM_PRODUCT_ID, NOTEFEED_CREEM_WEBHOOK_SECRET, PUBLIC_URL/);
  });
});
