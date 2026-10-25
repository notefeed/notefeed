import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { resetFeedsForTests } from "./feeds";
import { resetRateLimitsForTests } from "./limits";
import { hashKey } from "./licenseflow";
import { licenses, resetLicensesForTests } from "./licensing";
import { renderMetrics, resetMetricsForTest } from "./metrics";
import { changeMeta, createImageNote, createNote, removeNote } from "./notes";
import { deleteFeed, postNote } from "./posting";
import { resetStorageForTests, storage } from "./storage";
import type { FeedUsage } from "./storage/types";
import { countUsage, refreshUsage, resetUsageForTests, USAGE_MAX_AGE_MS } from "./usage";

const supported = Number(process.versions.node.split(".")[0]) >= 22;

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "notefeed-usage-"));
  vi.stubEnv("DATA_DIR", dir);
  vi.stubEnv("NOTEFEED_METRICS", "1");
  vi.stubEnv("NOTEFEED_SECRET", "s".repeat(32));
  vi.stubEnv("NOTEFEED_RATE_LIMIT", "0");
  resetFeedsForTests();
  resetRateLimitsForTests();
  resetStorageForTests();
  resetUsageForTests();
});
afterEach(async () => {
  resetMetricsForTest();
  await resetLicensesForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetFeedsForTests();
  resetStorageForTests();
  await rm(dir, { recursive: true, force: true });
});

// The value of the sample `metric` with exactly these labels (none: the unlabelled one); undefined when there is none.
async function sample(metric: string, labels: Record<string, string> = {}): Promise<number | undefined> {
  const { body } = await renderMetrics();
  const want = Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(",");
  const line = body.split("\n").find((l) => l.startsWith(want ? `${metric}{${want}} ` : `${metric} `));
  return line === undefined ? undefined : Number(line.slice(line.lastIndexOf(" ") + 1));
}

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 25);
const feed = (o: Partial<FeedUsage>): FeedUsage => ({ protected: false, readLink: true, lastWrite: null, notes: {}, ...o });
const md = (count: number) => ({ md: { count, bytes: count * 10 } });

test("countUsage: kinds by extension, the windows of activity, and files that are no notes left out", () => {
  const c = countUsage(
    [
      feed({ protected: true, lastWrite: NOW - DAY / 2, notes: { md: { count: 2, bytes: 20 }, png: { count: 1, bytes: 1000 }, jpg: { count: 2, bytes: 500 }, txt: { count: 9, bytes: 9 } } }),
      feed({ readLink: false, lastWrite: NOW - 3 * DAY, notes: md(1) }),
      feed({ lastWrite: NOW - 20 * DAY, notes: md(1) }),
      feed({ lastWrite: NOW - 40 * DAY, notes: md(1) }),
      feed({}),
    ],
    null,
    NOW,
  );
  expect(c).toEqual({
    feeds: 5,
    protected: 1,
    readLink: 4,
    active: { "1d": 1, "7d": 2, "30d": 3 },
    notes: { markdown: { count: 5, bytes: 50 }, image: { count: 3, bytes: 1500 } },
    freeCap: null,
  });
});

test("countUsage: near the cap is 80% of it or more, at it is the cap exactly, over it more (a license); images do not count", () => {
  const c = countUsage([feed({ notes: md(7) }), feed({ notes: md(8) }), feed({ notes: md(9) }), feed({ notes: md(10) }), feed({ notes: { ...md(11), png: { count: 50, bytes: 1 } } }), feed({ notes: { png: { count: 50, bytes: 1 } } })], 10, NOW);
  expect(c.freeCap).toEqual({ near: 2, at: 1, over: 1 });
});

test("the usage gauges are absent before the first count, and the first scrape waits for it", async () => {
  expect(await sample("notefeed_feeds")).toBeUndefined();
  await createNote("one", "a");
  await createNote("one", "b");
  await createImageNote("two", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]), {});
  await refreshUsage();
  expect(await sample("notefeed_feeds")).toBe(2);
  expect(await sample("notefeed_notes", { kind: "markdown" })).toBe(2);
  expect(await sample("notefeed_notes", { kind: "image" })).toBe(1);
  expect(await sample("notefeed_notes_bytes", { kind: "image" })).toBe(9);
  expect(await sample("notefeed_feeds_active", { within: "1d" })).toBe(2);
  expect(await sample("notefeed_feeds_with_read_link")).toBe(2);
  expect(await sample("notefeed_usage_counted_timestamp_seconds")).toBeGreaterThan(0);
  // Licensing is off: there is no cap and there are no licenses.
  expect(await sample("notefeed_licenses", { state: "active" })).toBeUndefined();
  expect(await sample("notefeed_feeds_free_cap", { notes: "at" })).toBeUndefined();
});

test("a count runs at most once per USAGE_MAX_AGE_MS; a scrape after that answers with the last count and starts the next", async () => {
  const s = storage();
  const original = s.usage.bind(s);
  const usage = vi.spyOn(s, "usage");
  await createNote("one", "a");
  const t = Date.now();
  await refreshUsage(t);
  await refreshUsage(t + 1000);
  await refreshUsage(t + USAGE_MAX_AGE_MS - 1);
  expect(usage).toHaveBeenCalledTimes(1);
  await createNote("two", "b");
  let release!: () => void;
  usage.mockImplementationOnce(async () => (await new Promise<void>((r) => (release = r)), original()));
  await refreshUsage(t + USAGE_MAX_AGE_MS);
  expect(usage).toHaveBeenCalledTimes(2);
  expect(await sample("notefeed_feeds")).toBe(1); // the last count, while the next one runs
  release();
});

test("a failed count keeps the last values", async () => {
  await createNote("one", "a");
  await refreshUsage(1);
  vi.spyOn(storage(), "usage").mockRejectedValueOnce(new Error("database down"));
  await refreshUsage(1 + USAGE_MAX_AGE_MS);
  await new Promise((r) => setTimeout(r, 0));
  expect(await sample("notefeed_feeds")).toBe(1);
});

test("the events count by kind and reason, and nothing in /metrics names a feed", async () => {
  const { note } = await createNote("secret-feed-name", "hello");
  await createNote("secret-feed-name", "again");
  await changeMeta("secret-feed-name", note.id, { title: "T" });
  await removeNote("secret-feed-name", note.id);
  await removeNote("secret-feed-name", "20260101T000000Z-nope");
  await createNote("other-feed", "x");
  await deleteFeed("other-feed", "ip", {});
  expect(await sample("notefeed_feeds_created_total", { protected: "false" })).toBe(2);
  expect(await sample("notefeed_notes_posted_total", { kind: "markdown" })).toBe(3);
  expect(await sample("notefeed_notes_edited_total", { kind: "markdown", what: "meta" })).toBe(1);
  expect(await sample("notefeed_notes_deleted_total", { kind: "markdown", reason: "deleted" })).toBe(1);
  expect(await sample("notefeed_feeds_deleted_total", { reason: "deleted" })).toBe(1);
  await refreshUsage();
  const { body } = await renderMetrics();
  expect(body).not.toMatch(/secret-feed-name|other-feed/);
  const readId = await storage().feedReadId("secret-feed-name");
  expect(body).not.toContain(readId!);
});

test.skipIf(!supported)("with licensing on: licenses by state, and the feeds against the free cap", async () => {
  vi.stubEnv("NOTEFEED_PAYMENT_PROVIDER", "fake");
  vi.stubEnv("NOTEFEED_FAKE_WEBHOOK_SECRET", "w");
  vi.stubEnv("NOTEFEED_FREE_NOTE_CAP", "5");
  const post = (feed: string, body: string) => postNote(feed, "ip", async () => ({ body: new TextEncoder().encode(body), mediaType: "text/markdown" }), {});
  for (let i = 0; i < 4; i++) await post("near", `n${i}`);
  for (let i = 0; i < 6; i++) await post("capped", `n${i}`); // trimmed to the cap as it goes
  await licenses().createLicense({ keyHash: hashKey("k".repeat(22)), providerRef: "sub_1", validUntil: null });
  await licenses().attach(hashKey("k".repeat(22)), "near");
  await licenses().createLicense({ keyHash: hashKey("j".repeat(22)), providerRef: "sub_2", validUntil: null });
  await refreshUsage();
  expect(await sample("notefeed_licenses", { state: "active" })).toBe(1);
  expect(await sample("notefeed_licenses", { state: "unattached" })).toBe(1);
  expect(await sample("notefeed_licenses", { state: "lapsed" })).toBe(0);
  expect(await sample("notefeed_feeds_free_cap", { notes: "near" })).toBe(1);
  expect(await sample("notefeed_feeds_free_cap", { notes: "at" })).toBe(1);
  expect(await sample("notefeed_notes_deleted_total", { kind: "markdown", reason: "free_cap" })).toBe(1);
});

test.skipIf(!supported)("on a database: its size; on SQLite no connections", async () => {
  vi.stubEnv("NOTEFEED_STORAGE", "sqlite");
  await createNote("one", "a");
  await refreshUsage();
  expect(await sample("notefeed_database_size_bytes")).toBeGreaterThan(0);
  expect(await sample("notefeed_database_connections")).toBeUndefined();
  expect(await sample("notefeed_feeds")).toBe(1);
});

test("on file storage there is no database to measure", async () => {
  await createNote("one", "a");
  await refreshUsage();
  expect(await sample("notefeed_database_size_bytes")).toBeUndefined();
});
