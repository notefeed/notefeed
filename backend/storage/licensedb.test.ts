import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createLicenseDb, type LicenseDb } from "./licensedb";

// better-sqlite3 and kysely need Node 22 (the project's version); on an older Node the SQL tests are skipped.
const supported = Number(process.versions.node.split(".")[0]) >= 22;

let dir = "";
const open: LicenseDb[] = [];
const fresh = (file = join(dir, "licenses.db")) => {
  const db = createLicenseDb(file);
  open.push(db);
  return db;
};
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "notefeed-licensedb-"));
});
afterEach(async () => {
  for (const db of open.splice(0)) await db.close();
  await rm(dir, { recursive: true, force: true });
});

describe.skipIf(!supported)("license store (ADR 0029)", () => {
  test("a new license is active, on no feed, and found by its key hash and its reference", async () => {
    const licenses = fresh();
    const l = await licenses.createLicense({ keyHash: "h1", providerRef: "sub_1", validUntil: 1000 });
    expect(l).toMatchObject({ feed: null, status: "active", providerRef: "sub_1", validUntil: 1000 });
    expect(await licenses.byKeyHash("h1")).toEqual(l);
    expect(await licenses.byProviderRef("sub_1")).toEqual(l);
    expect(await licenses.byKeyHash("other")).toBeNull();
  });

  test("the same subscription twice (a webhook delivered again) is the first license", async () => {
    const licenses = fresh();
    const a = await licenses.createLicense({ keyHash: "h1", providerRef: "sub_1", validUntil: null });
    const b = await licenses.createLicense({ keyHash: "h2", providerRef: "sub_1", validUntil: null });
    expect(b.id).toBe(a.id);
    expect(await licenses.byKeyHash("h2")).toBeNull();
  });

  test("attaching puts it on the feed, one license per feed, and a missing key is said", async () => {
    const licenses = fresh();
    await licenses.createLicense({ keyHash: "h1", providerRef: "sub_1", validUntil: null });
    await licenses.createLicense({ keyHash: "h2", providerRef: "sub_2", validUntil: null });
    expect(await licenses.attach("h1", "f")).toBe("attached");
    expect((await licenses.byFeed("f"))?.providerRef).toBe("sub_1");
    expect(await licenses.attach("h2", "f")).toBe("feed-has-license");
    expect(await licenses.attach("nope", "g")).toBe("unknown-key");
    expect(await licenses.byFeed("g")).toBeNull();
  });

  test("a license moves to another feed, and detaching needs only the feed", async () => {
    const licenses = fresh();
    await licenses.createLicense({ keyHash: "h1", providerRef: "sub_1", validUntil: null });
    await licenses.attach("h1", "f");
    expect(await licenses.attach("h1", "g")).toBe("attached");
    expect(await licenses.byFeed("f")).toBeNull();
    expect((await licenses.byFeed("g"))?.providerRef).toBe("sub_1");
    expect(await licenses.detach("g")).toBe(true);
    expect(await licenses.detach("g")).toBe(false);
    expect((await licenses.byKeyHash("h1"))?.feed).toBeNull();
  });

  test("the webhook's changes apply by reference, and an unknown reference is false", async () => {
    const licenses = fresh();
    await licenses.createLicense({ keyHash: "h1", providerRef: "sub_1", validUntil: 1 });
    expect(await licenses.update("sub_1", { status: "lapsed" })).toBe(true);
    expect(await licenses.byProviderRef("sub_1")).toMatchObject({ status: "lapsed", validUntil: 1 });
    expect(await licenses.update("sub_1", { status: "active", validUntil: 99 })).toBe(true);
    expect(await licenses.byProviderRef("sub_1")).toMatchObject({ status: "active", validUntil: 99 });
    expect(await licenses.update("sub_x", { status: "lapsed" })).toBe(false);
  });

  test("the licenses are in their own file and are still there when it is opened again", async () => {
    const file = join(dir, "nested", "licenses.db");
    const first = fresh(file);
    await first.createLicense({ keyHash: "h1", providerRef: "sub_1", validUntil: null });
    await first.attach("h1", "f");
    await first.close();
    const again = fresh(file);
    expect(await again.byFeed("f")).toMatchObject({ providerRef: "sub_1", status: "active" });
  });
});
