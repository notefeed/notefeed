import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { connect } from "./connect";
import { createSqlStorage, type SqlStorage } from ".";

// better-sqlite3 and kysely need Node 22 (the project's version); on an older Node the SQL tests are skipped.
const supported = Number(process.versions.node.split(".")[0]) >= 22;

const open: { storage: SqlStorage; root: string }[] = [];
async function fresh() {
  const root = await mkdtemp(join(tmpdir(), "notefeed-licenses-"));
  const storage = createSqlStorage(() => connect("sqlite", `file:${join(root, "test.db")}`), "sqlite");
  open.push({ storage, root });
  return storage;
}
afterEach(async () => {
  for (const { storage, root } of open.splice(0)) {
    await storage.close();
    await rm(root, { recursive: true, force: true });
  }
});

describe.skipIf(!supported)("licenses (ADR 0029)", () => {
  test("a new license is active, on no feed, and found by its key hash and its reference", async () => {
    const { licenses } = await fresh();
    const l = await licenses.createLicense({ keyHash: "h1", providerRef: "sub_1", validUntil: 1000 });
    expect(l).toMatchObject({ feed: null, status: "active", providerRef: "sub_1", validUntil: 1000 });
    expect(await licenses.byKeyHash("h1")).toEqual(l);
    expect(await licenses.byProviderRef("sub_1")).toEqual(l);
    expect(await licenses.byKeyHash("other")).toBeNull();
  });

  test("the same subscription twice (a webhook delivered again) is the first license", async () => {
    const { licenses } = await fresh();
    const a = await licenses.createLicense({ keyHash: "h1", providerRef: "sub_1", validUntil: null });
    const b = await licenses.createLicense({ keyHash: "h2", providerRef: "sub_1", validUntil: null });
    expect(b.id).toBe(a.id);
    expect(await licenses.byKeyHash("h2")).toBeNull();
  });

  test("attaching puts it on the feed, one license per feed, and a missing feed or key is said", async () => {
    const s = await fresh();
    await s.createFeed("f", "rid-f");
    await s.createFeed("g", "rid-g");
    await s.licenses.createLicense({ keyHash: "h1", providerRef: "sub_1", validUntil: null });
    await s.licenses.createLicense({ keyHash: "h2", providerRef: "sub_2", validUntil: null });
    expect(await s.licenses.attach("h1", "f")).toBe("attached");
    expect((await s.licenses.byFeed("f"))?.providerRef).toBe("sub_1");
    expect(await s.licenses.attach("h2", "f")).toBe("feed-has-license");
    expect(await s.licenses.attach("nope", "g")).toBe("unknown-key");
    expect(await s.licenses.attach("h2", "missing")).toBe("no-feed");
    expect(await s.licenses.byFeed("g")).toBeNull();
  });

  test("a license moves to another feed, and detaching needs only the feed", async () => {
    const s = await fresh();
    await s.createFeed("f", "rid-f");
    await s.createFeed("g", "rid-g");
    await s.licenses.createLicense({ keyHash: "h1", providerRef: "sub_1", validUntil: null });
    await s.licenses.attach("h1", "f");
    expect(await s.licenses.attach("h1", "g")).toBe("attached");
    expect(await s.licenses.byFeed("f")).toBeNull();
    expect((await s.licenses.byFeed("g"))?.providerRef).toBe("sub_1");
    expect(await s.licenses.detach("g")).toBe(true);
    expect(await s.licenses.detach("g")).toBe(false);
    expect((await s.licenses.byKeyHash("h1"))?.feed).toBeNull();
  });

  test("the webhook's changes apply by reference, and an unknown reference is false", async () => {
    const s = await fresh();
    await s.licenses.createLicense({ keyHash: "h1", providerRef: "sub_1", validUntil: 1 });
    expect(await s.licenses.update("sub_1", { status: "lapsed" })).toBe(true);
    expect(await s.licenses.byProviderRef("sub_1")).toMatchObject({ status: "lapsed", validUntil: 1 });
    expect(await s.licenses.update("sub_1", { status: "active", validUntil: 99 })).toBe(true);
    expect(await s.licenses.byProviderRef("sub_1")).toMatchObject({ status: "active", validUntil: 99 });
    expect(await s.licenses.update("sub_x", { status: "lapsed" })).toBe(false);
  });

  test("a deleted feed leaves its license, unattached, to be attached elsewhere", async () => {
    const s = await fresh();
    await s.createFeed("f", "rid-f");
    await s.licenses.createLicense({ keyHash: "h1", providerRef: "sub_1", validUntil: null });
    await s.licenses.attach("h1", "f");
    await s.deleteFeed("f");
    expect((await s.licenses.byKeyHash("h1"))?.feed).toBeNull();
  });
});
