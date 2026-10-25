// The contract suite against a real PostgreSQL. Set NOTEFEED_TEST_POSTGRES_URL to a throwaway database, e.g.
//   docker run -d --rm --name nf-pg -e POSTGRES_PASSWORD=pw -p 55432:5432 postgres:17-alpine
//   NOTEFEED_TEST_POSTGRES_URL=postgres://postgres:pw@localhost:55432/postgres npx vitest run backend/storage/sql/postgres.test.ts
// The tests use their own schema (nf_test) and drop it before each test; nothing else in the database is touched.
import { afterEach, describe, expect, test } from "vitest";
import { describeStorage } from "../contract";
import { createS3ImageStore } from "../images/s3";
import { newKey } from "../images/types";
import { connect } from "./connect";
import { MIGRATION_NAMES } from "./migrations";
import { createSqlStorage, type Images, type SqlStorage } from ".";
import { randomBytes } from "node:crypto";
import { createOpenBaoWrapper } from "../openbao";
import { openBaoAddr, openBaoForTests } from "../openbao.testkit";
import { createLocalWrapper, type KeyWrapper } from "../wrapper";
import { after } from "./testhooks";

const base = process.env.NOTEFEED_TEST_POSTGRES_URL ?? "";
const supported = Number(process.versions.node.split(".")[0]) >= 22; // kysely needs Node 22
if (!base) console.info("NOTEFEED_TEST_POSTGRES_URL not set: skipping the PostgreSQL contract run");

// Every connection of a test works in the nf_test schema.
const url = () => `${base}${base.includes("?") ? "&" : "?"}options=${encodeURIComponent("-c search_path=nf_test")}`;

async function resetSchema() {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: base });
  await client.connect();
  await client.query("drop schema if exists nf_test cascade");
  await client.query("create schema nf_test");
  await client.end();
}

const open: SqlStorage[] = [];
const fresh = (images?: Images, wrapper?: KeyWrapper) => {
  const s = createSqlStorage(() => connect("postgres", url()), "postgres", images, wrapper);
  open.push(s);
  return s;
};
afterEach(async () => {
  for (const s of open.splice(0)) await s.close();
});

describe.skipIf(!base || !supported)("postgres", () => {
  describeStorage("postgres", async () => {
    await resetSchema();
    return { storage: fresh(), cleanup: async () => {} };
  });
  describeStorage("postgres, encrypted", async () => {
    await resetSchema();
    return { storage: fresh(undefined, createLocalWrapper(randomBytes(32).toString("hex"))), cleanup: async () => {} };
  });

  describe.skipIf(!openBaoAddr())("with the key service", () => {
    let bao: ReturnType<typeof openBaoForTests> | undefined;
    describeStorage("postgres, encrypted by OpenBao", async () => {
      await resetSchema();
      return { storage: fresh(undefined, createOpenBaoWrapper((await (bao ??= openBaoForTests()))!)), cleanup: async () => {} };
    });
  });

  // The hosted service's shape: rows in PostgreSQL, image bytes in an S3-compatible store. Needs NOTEFEED_TEST_S3_ENDPOINT and its
  // keys as well (see images/s3.test.ts); the bucket is made here if it is not there.
  const s3 = process.env.NOTEFEED_TEST_S3_ENDPOINT ?? "";
  describe.skipIf(!s3)("with images in an S3-compatible store", () => {
    const o = {
      endpoint: s3,
      bucket: process.env.NOTEFEED_TEST_S3_BUCKET || "notefeed-test",
      region: process.env.NOTEFEED_TEST_S3_REGION || "us-east-1",
      accessKey: process.env.NOTEFEED_TEST_S3_ACCESS_KEY ?? "",
      secretKey: process.env.NOTEFEED_TEST_S3_SECRET_KEY ?? "",
    };
    describeStorage("postgres with images in S3", async () => {
      await resetSchema();
      const { AwsClient } = await import("aws4fetch");
      const made = await new AwsClient({ accessKeyId: o.accessKey, secretAccessKey: o.secretKey, service: "s3", region: o.region }).fetch(`${o.endpoint.replace(/\/+$/, "")}/${o.bucket}`, { method: "PUT" });
      if (!made.ok && made.status !== 409) throw new Error(`could not make the test bucket (${made.status})`);
      return { storage: fresh({ store: createS3ImageStore(o), external: (ext) => ext === "png" }), cleanup: async () => {} };
    });

    // In a bucket of its own: the clean-up removes whatever no note names, and the other tests' objects are in the shared one.
    test("the clean-up removes an object no note names from a real store, and keeps a note's image", async () => {
      await resetSchema();
      const mine = { ...o, bucket: `${o.bucket}-sweep` };
      const { AwsClient } = await import("aws4fetch");
      const made = await new AwsClient({ accessKeyId: o.accessKey, secretAccessKey: o.secretKey, service: "s3", region: o.region }).fetch(`${o.endpoint.replace(/\/+$/, "")}/${mine.bucket}`, { method: "PUT" });
      if (!made.ok && made.status !== 409) throw new Error(`could not make the test bucket (${made.status})`);
      const store = createS3ImageStore(mine);
      const s = fresh({ store, external: (ext) => ext === "png" });
      await s.sweepImages({ remove: true, olderThanMs: 0 }); // what an earlier run left
      await s.createFeed("f", "rid-f");
      await s.writeNote("f", "p", "png", Buffer.from("kept"), {});
      const orphan = newKey();
      await store.put(orphan, Buffer.from("12345"));
      expect(await s.sweepImages({ remove: false, olderThanMs: 0 })).toMatchObject({ unreferenced: { count: 1, bytes: 5 }, deleted: { count: 0 }, missing: 0 });
      expect(await s.sweepImages({ remove: false, olderThanMs: 3_600_000 })).toMatchObject({ unreferenced: { count: 0 }, tooRecent: 2 });
      expect(await s.sweepImages({ remove: true, olderThanMs: 0 })).toMatchObject({ deleted: { count: 1, bytes: 5 }, failed: 0 });
      expect(await store.get(orphan)).toBeNull();
      expect((await s.readFile("f", "p.png"))?.toString()).toBe("kept");
    });
  });

  test("databaseStats: the database's size and its open connections, this one among them", async () => {
    await resetSchema();
    const s = fresh();
    await s.createFeed("f", "rid-f");
    const { bytes, connections } = await s.databaseStats();
    expect(bytes).toBeGreaterThan(0);
    expect(connections).toBeGreaterThanOrEqual(1);
  });

  test("two starts at the same time migrate once", async () => {
    await resetSchema();
    const [a, b] = [fresh(), fresh()];
    await Promise.all([a.feedCount(), b.feedCount()]);
    const { Client } = await import("pg");
    const client = new Client({ connectionString: base });
    await client.connect();
    const r = await client.query("select count(*)::int as n from nf_test.kysely_migration");
    await client.end();
    expect(r.rows[0].n).toBe(MIGRATION_NAMES.length);
  });

  test("an unreachable database says NOTEFEED_DATABASE_URL and not the address", async () => {
    const s = createSqlStorage(() => connect("postgres", "postgres://nobody:hunter2@127.0.0.1:1/none"), "postgres");
    open.push(s);
    const err = (await s.feedCount().catch((e: Error) => e)) as Error;
    expect(err.message).toMatch(/NOTEFEED_DATABASE_URL/);
    expect(err.message).not.toMatch(/hunter2|127\.0\.0\.1/);
    expect(err.cause).toBeUndefined(); // the driver's error would carry the address
  });

  test("two starts convert once", async () => {
    await resetSchema();
    const plain = fresh();
    for (const n of ["a", "b", "c"]) await plain.createFeed(n, `rid-${n}`);
    await plain.writeNote("a", "n", "md", "x", {});
    await plain.close();
    const w = createLocalWrapper(randomBytes(32).toString("hex"));
    const [one, two] = [fresh(undefined, w), fresh(undefined, w)];
    const [l1, l2] = await Promise.all([one.listFeeds(), two.listFeeds()]);
    expect(l1).toEqual(["a", "b", "c"]);
    expect(l2).toEqual(["a", "b", "c"]);
    expect(await one.feedCount()).toBe(3);
    expect((await two.readNote("a", "n", ["md"], () => true))?.content.toString()).toBe("x");
    const { Client } = await import("pg");
    const client = new Client({ connectionString: base });
    await client.connect();
    const ring = await client.query("select count(*)::int as n from nf_test.keyring");
    const keyed = await client.query("select count(*)::int as n from nf_test.feeds where key_id is not null");
    await client.end();
    expect(ring.rows[0].n).toBe(1);
    expect(keyed.rows[0].n).toBe(3);
  });

  test("an edit of a note's metadata while reseal seals it is kept, sealed", async () => {
    await resetSchema();
    const plain = fresh();
    await plain.createFeed("f", "rid-f");
    await plain.writeNote("f", "n", "md", "text", { title: "old" });
    await plain.close();
    const w = createLocalWrapper(randomBytes(32).toString("hex"));
    const other = fresh(undefined, w);
    await other.listFeeds(); // converts the feeds first
    const hooked = createSqlStorage(async () => (await connect("postgres", url())).withPlugin(after(["ext", "metadata", "sealed"], async () => void (await other.reseal({ limit: 10 })))), "postgres", undefined, w);
    open.push(hooked);
    expect(await hooked.updateMeta("f", "n", ["md"], { title: "new" })).toBe(true);
    expect(await other.readMeta("f", { id: "n", ext: "md" })).toEqual({ title: "new" });
    const { Client } = await import("pg");
    const client = new Client({ connectionString: base });
    await client.connect();
    const row = await client.query("select metadata, sealed from nf_test.notes");
    await client.end();
    expect(row.rows[0].sealed).toBe(1);
    expect(row.rows[0].metadata).not.toContain("new");
  });
});
