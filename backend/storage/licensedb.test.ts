import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { randomBytes } from "node:crypto";
import { Kysely, SqliteDialect } from "kysely";
import { createLicenseDb, type LicenseDb } from "./licensedb";
import { createOpenBaoWrapper } from "./openbao";
import { openBaoAddr, openBaoForTests } from "./openbao.testkit";
import { createLocalWrapper, createOldKeysWrapper, type KeyWrapper } from "./wrapper";

// better-sqlite3 and kysely need Node 22 (the project's version); on an older Node the SQL tests are skipped.
const supported = Number(process.versions.node.split(".")[0]) >= 22;

let dir = "";
const open: LicenseDb[] = [];
const make = (file: string, wrapper: KeyWrapper | null) => {
  const db = createLicenseDb(file, wrapper);
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

// The same cases plain and encrypted (issue #212).
for (const [label, wrapper] of [["license store (ADR 0029)", null], ["license store, encrypted", createLocalWrapper(randomBytes(32).toString("hex"))]] as const) {
const fresh = (file = join(dir, "licenses.db")) => make(file, wrapper);
describe.skipIf(!supported)(label, () => {
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

  test("counts: paid on a feed, paid on none, and lapsed by status or by an ended period", async () => {
    const licenses = fresh();
    expect(await licenses.counts(100)).toEqual({ active: 0, unattached: 0, lapsed: 0 });
    await licenses.createLicense({ keyHash: "h1", providerRef: "sub_1", validUntil: null });
    await licenses.createLicense({ keyHash: "h2", providerRef: "sub_2", validUntil: 200 });
    await licenses.createLicense({ keyHash: "h3", providerRef: "sub_3", validUntil: 50 });
    await licenses.createLicense({ keyHash: "h4", providerRef: "sub_4", validUntil: null });
    await licenses.attach("h1", "f");
    await licenses.attach("h3", "g");
    await licenses.update("sub_4", { status: "lapsed" });
    expect(await licenses.counts(100)).toEqual({ active: 1, unattached: 1, lapsed: 2 });
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
}

// What a thief with a copy of the file sees.
async function rawRows(file: string) {
  const Database = (await import("better-sqlite3")).default;
  const db = new Kysely<any>({ dialect: new SqliteDialect({ database: new Database(file) }) }); // eslint-disable-line @typescript-eslint/no-explicit-any
  const rows = JSON.stringify([...(await db.selectFrom("licenses").selectAll().execute()), ...(await db.selectFrom("keyring").selectAll().execute())]);
  await db.destroy();
  return rows;
}

describe.skipIf(!supported)("license store: encryption at rest", () => {
  const key = () => randomBytes(32).toString("hex");

  test("a stolen license database shows no feed name or provider ref", async () => {
    const file = join(dir, "licenses.db");
    const licenses = make(file, createLocalWrapper(key()));
    await licenses.createLicense({ keyHash: "h1", providerRef: "sub_secret_1", validUntil: null });
    await licenses.attach("h1", "secret-feed");
    const rows = await rawRows(file);
    expect(rows).not.toContain("sub_secret_1");
    expect(rows).not.toContain("secret-feed");
    expect(await licenses.byFeed("secret-feed")).toMatchObject({ feed: "secret-feed", providerRef: "sub_secret_1" });
  });

  test("a plain license database is converted at open", async () => {
    const file = join(dir, "licenses.db");
    const plain = make(file, null);
    await plain.createLicense({ keyHash: "h1", providerRef: "sub_secret_1", validUntil: 5 });
    await plain.attach("h1", "secret-feed");
    await plain.close();
    const encrypted = make(file, createLocalWrapper(key()));
    expect(await encrypted.byFeed("secret-feed")).toMatchObject({ feed: "secret-feed", providerRef: "sub_secret_1", validUntil: 5 });
    expect(await encrypted.byProviderRef("sub_secret_1")).not.toBeNull();
    const rows = await rawRows(file);
    expect(rows).not.toContain("sub_secret_1");
    expect(rows).not.toContain("secret-feed");
  });

  test("a key change re-wraps", async () => {
    const file = join(dir, "licenses.db");
    const [a, b] = [key(), key()];
    const first = make(file, createLocalWrapper(a));
    await first.createLicense({ keyHash: "h1", providerRef: "sub_1", validUntil: null });
    await first.attach("h1", "f");
    await first.close();
    const changed = make(file, createLocalWrapper(b, [a]));
    expect((await changed.byFeed("f"))?.providerRef).toBe("sub_1");
    await changed.close();
    expect((await make(file, createLocalWrapper(b)).byProviderRef("sub_1"))?.feed).toBe("f");
  });

  test.skipIf(!openBaoAddr())("moves from the local key to OpenBao (#215)", async () => {
    const bao = (await openBaoForTests())!;
    const file = join(dir, "licenses.db");
    const local = key();
    const first = make(file, createLocalWrapper(local));
    await first.createLicense({ keyHash: "h1", providerRef: "sub_1", validUntil: null });
    await first.attach("h1", "f");
    await first.close();
    const moved = make(file, createOpenBaoWrapper({ ...bao, old: createOldKeysWrapper([local]) }));
    expect((await moved.byFeed("f"))?.providerRef).toBe("sub_1");
    await moved.close();
    expect((await make(file, createOpenBaoWrapper(bao)).byProviderRef("sub_1"))?.feed).toBe("f");
  });

  test("refuses without the key", async () => {
    const file = join(dir, "licenses.db");
    const first = make(file, createLocalWrapper(key()));
    await first.createLicense({ keyHash: "h1", providerRef: "sub_1", validUntil: null });
    await first.close();
    await expect(make(file, null).byKeyHash("h1")).rejects.toThrow("the license database is encrypted, but NOTEFEED_ENCRYPTION_KEY is not set");
    await expect(make(file, createLocalWrapper(key())).byKeyHash("h1")).rejects.toThrow(/^the license database holds keys wrapped by a main key notefeed does not have/);
  });
});
