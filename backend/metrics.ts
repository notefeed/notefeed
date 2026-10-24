// Metrics in the Prometheus text format (GET /metrics, see backend/http/metrics.ts). The only importer of prom-client. The
// counters live in this process's memory and start again at 0 on a restart; Prometheus keeps the history. Labels are fixed
// values only: never a feed name, read id, text, sender or address.
import { AsyncLocalStorage } from "node:async_hooks";
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "prom-client";
import { config } from "./config";
import { processState } from "./state";

const SECONDS = [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];
const COUNTS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000];

type Metrics = {
  register: Registry;
  duration: Histogram<"kind" | "status" | "feed_size">; dirs: Histogram<"kind" | "feed_size">; files: Histogram<"kind" | "feed_size">;
  parse: Histogram;
  timeouts: Counter;
  unreadable: Counter;
  waiting: Gauge;
  images?: { count: Gauge; bytes: Gauge; missing: Gauge; at: Gauge };
  events: { feedsCreated: Counter<"protected">; feedsDeleted: Counter<"reason">; posted: Counter<"kind">; edited: Counter<"kind" | "what">; deleted: Counter<"kind" | "reason">; licenses: Counter<"event"> };
  usage: {
    feeds: Gauge; protected: Gauge; readLink: Gauge; active: Gauge<"within">; notes: Gauge<"kind">; bytes: Gauge<"kind">; nearCap: Gauge<"notes">; licenses: Gauge<"state">;
    at: Gauge; took: Gauge;
  };
};

// One set for all route bundles (see processState), created on first use: with metrics off it never exists.
function metrics(): Metrics {
  return processState("metrics", () => {
    const register = new Registry();
    collectDefaultMetrics({ register, prefix: "notefeed_" });
    return {
      register,
      duration: new Histogram({ name: "notefeed_request_duration_seconds", help: "Request duration by route kind, status class and the size of the feed it ran against", labelNames: ["kind", "status", "feed_size"], buckets: SECONDS, registers: [register] }),
      dirs: new Histogram({ name: "notefeed_request_dir_reads", help: "Directory reads per request", labelNames: ["kind", "feed_size"], buckets: COUNTS, registers: [register] }),
      files: new Histogram({ name: "notefeed_request_file_reads", help: "File reads per request", labelNames: ["kind", "feed_size"], buckets: COUNTS, registers: [register] }),
      parse: new Histogram({ name: "notefeed_parse_duration_seconds", help: "How long reading a text in the picture-reading worker took", buckets: SECONDS, registers: [register] }),
      timeouts: new Counter({ name: "notefeed_parse_timeouts_total", help: "Texts refused because reading them took longer than NOTEFEED_PARSE_TIMEOUT_MS", registers: [register] }),
      unreadable: new Counter({ name: "notefeed_notes_unreadable_total", help: "Reads of a note whose stored copy could not be decrypted (encryption at rest): damaged or tampered with", registers: [register] }),
      waiting: new Gauge({ name: "notefeed_parse_waiting", help: "Texts waiting for a picture-reading worker", registers: [register] }),
      // What happened since the process started, for rates and trends. Labels are fixed values only.
      events: {
        feedsCreated: new Counter({ name: "notefeed_feeds_created_total", help: "Feeds created, by whether they were protected from the start", labelNames: ["protected"], registers: [register] }),
        feedsDeleted: new Counter({ name: "notefeed_feeds_deleted_total", help: "Feeds removed: deleted by their owner, or taken down by the operator", labelNames: ["reason"], registers: [register] }),
        posted: new Counter({ name: "notefeed_notes_posted_total", help: "Notes posted, by kind", labelNames: ["kind"], registers: [register] }),
        edited: new Counter({ name: "notefeed_notes_edited_total", help: "Notes edited, by kind and by what changed (content or metadata)", labelNames: ["kind", "what"], registers: [register] }),
        deleted: new Counter({ name: "notefeed_notes_deleted_total", help: "Notes deleted, by kind: by a writer, or dropped past the free tier's cap", labelNames: ["kind", "reason"], registers: [register] }),
        licenses: new Counter({ name: "notefeed_license_events_total", help: "License events: bought, attached to a feed, renewed, lapsed", labelNames: ["event"], registers: [register] }),
      },
      // How much the instance holds, as of the last count (backend/usage.ts): counting means a pass over every feed, so it runs
      // at most every few minutes, never per scrape. Before the first count these are absent, not 0.
      usage: {
        feeds: new Gauge({ name: "notefeed_feeds", help: "Feeds, as of the last count", registers: [] }),
        protected: new Gauge({ name: "notefeed_feeds_protected", help: "Protected feeds (with a feed password), as of the last count", registers: [] }),
        readLink: new Gauge({ name: "notefeed_feeds_with_read_link", help: "Feeds that have a read link, as of the last count", registers: [] }),
        active: new Gauge({ name: "notefeed_feeds_active", help: "Feeds with a note written within the last day, 7 or 30 days, as of the last count", labelNames: ["within"], registers: [] }),
        notes: new Gauge({ name: "notefeed_notes", help: "Stored notes by kind, as of the last count", labelNames: ["kind"], registers: [] }),
        bytes: new Gauge({ name: "notefeed_notes_bytes", help: "Bytes of the stored notes by kind (an image's bytes wherever the image store keeps them), as of the last count", labelNames: ["kind"], registers: [] }),
        nearCap: new Gauge({ name: "notefeed_feeds_free_cap", help: "Feeds by their markdown notes against the free tier's cap: near (80% or more), at it, or over it (a license, or one lapsed since); only with licensing on", labelNames: ["notes"], registers: [] }),
        licenses: new Gauge({ name: "notefeed_licenses", help: "Licenses: active (paid, on a feed), unattached (paid, the key not entered) and lapsed; only with licensing on", labelNames: ["state"], registers: [] }),
        at: new Gauge({ name: "notefeed_usage_counted_timestamp_seconds", help: "When the usage gauges were last counted", registers: [] }),
        took: new Gauge({ name: "notefeed_usage_count_duration_seconds", help: "How long the last count of the usage gauges took", registers: [] }),
      },
    };
  });
}

export async function renderMetrics(): Promise<{ contentType: string; body: string }> {
  const { register } = metrics();
  return { contentType: register.contentType, body: await register.metrics() };
}

/** Tests only: every sample back to its start. The registry stays: its default collectors cannot be stopped, so a new one would leak them. */
export function resetMetricsForTest(): void {
  const m = metrics();
  for (const metric of [m.duration, m.dirs, m.files, m.parse, m.timeouts, m.unreadable, m.waiting, ...Object.values(m.events)]) metric.reset();
  for (const g of Object.values(m.usage)) {
    g.reset();
    m.register.removeSingleMetric((g as unknown as { name: string }).name);
  }
  for (const name of ["notefeed_images_unreferenced", "notefeed_images_unreferenced_bytes", "notefeed_images_missing", "notefeed_images_checked_timestamp_seconds"]) m.register.removeSingleMetric(name);
  m.images = undefined;
}

export type FeedSize = "none" | "lt10" | "lt100" | "lt1000" | "gte1000";

/** The size class of a feed by its number of notes; `none` for a request that never read a feed. */
export function sizeBucket(notes: number | null): FeedSize {
  if (notes === null) return "none";
  return notes < 10 ? "lt10" : notes < 100 ? "lt100" : notes < 1000 ? "lt1000" : "gte1000";
}

/** A redirect counts as a success here (a posted form answers 303). */
export function statusClass(status: number): "2xx" | "4xx" | "5xx" {
  return status >= 500 ? "5xx" : status >= 400 ? "4xx" : "2xx";
}

type Scope = { dirs: number; files: number; size: number | null };
const scope = () => processState("metrics-scope", () => new AsyncLocalStorage<Scope>());

/**
 * Runs `fn` as one measured request: its duration, and the directory and file reads and the feed size that the data layer
 * reports meanwhile, are recorded under `kind` (a fixed name, never user input). A throw counts as 5xx and goes on.
 */
export async function measured<T>(kind: string, fn: () => Promise<T>, statusOf: (result: T) => number): Promise<T> {
  if (!config.metrics()) return fn();
  const own: Scope = { dirs: 0, files: 0, size: null };
  const start = performance.now();
  let status = 500;
  try {
    const result = await scope().run(own, fn);
    status = statusOf(result);
    return result;
  } finally {
    const m = metrics();
    const feed_size = sizeBucket(own.size);
    m.duration.observe({ kind, status: statusClass(status), feed_size }, (performance.now() - start) / 1000);
    m.dirs.observe({ kind, feed_size }, own.dirs);
    m.files.observe({ kind, feed_size }, own.files);
  }
}

/** One directory read of the current request; nothing outside a measured request. */
export const countDir = (): void => void (scope().getStore() && scope().getStore()!.dirs++);
/** One file read of the current request. */
export const countFile = (): void => void (scope().getStore() && scope().getStore()!.files++);
/** The number of notes of the feed the current request is reading. */
export function noteFeedSize(notes: number): void {
  const s = scope().getStore();
  if (s) s.size = notes;
}

// The picture-reading worker (backend/place.ts); each does nothing with metrics off.
/** One text read in a worker took this long (a refused one too). */
export const observeParse = (seconds: number): void => void (config.metrics() && metrics().parse.observe(seconds));
/** One text was refused for time. */
export const parseTimedOut = (): void => void (config.metrics() && metrics().timeouts.inc());
export const noteUnreadable = (): void => void (config.metrics() && metrics().unreadable.inc());
/** The number of texts waiting for a worker now. */
// What the last clean-up of the image store found (backend/http/operator.ts). Counting means listing the whole store, far too much
// for every scrape, so these say what the last run saw and when it was. Made on the first run: before it they are absent, not 0.
export function imagesSwept(left: { count: number; bytes: number; missing: number }, now = Date.now()): void {
  if (!config.metrics()) return;
  const m = metrics();
  const { register } = m;
  const g = (m.images ??= {
    count: new Gauge({ name: "notefeed_images_unreferenced", help: "Objects in the image store that no note names, as of the last clean-up or report", registers: [register] }),
    bytes: new Gauge({ name: "notefeed_images_unreferenced_bytes", help: "Their size in bytes", registers: [register] }),
    missing: new Gauge({ name: "notefeed_images_missing", help: "Image notes whose object is not in the image store, as of the last clean-up or report", registers: [register] }),
    at: new Gauge({ name: "notefeed_images_checked_timestamp_seconds", help: "When the image store was last checked for unreferenced objects", registers: [register] }),
  });
  g.count.set(left.count);
  g.bytes.set(left.bytes);
  g.missing.set(left.missing);
  g.at.set(Math.floor(now / 1000));
}

export const setParseWaiting = (n: number): void => void (config.metrics() && metrics().waiting.set(n));

// The events behind the trends. Each does nothing with metrics off.
type NoteKind = string; // a NoteType's name (backend/note/types.ts): "markdown", "image"
export const feedCreated = (isProtected: boolean): void => void (config.metrics() && metrics().events.feedsCreated.inc({ protected: String(isProtected) }));
export const feedRemoved = (reason: "deleted" | "takedown"): void => void (config.metrics() && metrics().events.feedsDeleted.inc({ reason }));
export const notePosted = (kind: NoteKind): void => void (config.metrics() && metrics().events.posted.inc({ kind }));
export const noteEdited = (kind: NoteKind, what: "content" | "meta"): void => void (config.metrics() && metrics().events.edited.inc({ kind, what }));
export const noteDeleted = (kind: NoteKind, reason: "deleted" | "free_cap"): void => void (config.metrics() && metrics().events.deleted.inc({ kind, reason }));
export const licenseEvent = (event: "bought" | "attached" | "renewed" | "lapsed"): void => void (config.metrics() && metrics().events.licenses.inc({ event }));

/** One count of what the instance holds (backend/usage.ts makes it). Numbers only: nothing in it names a feed. */
export type UsageCount = {
  feeds: number;
  protected: number;
  readLink: number;
  active: { "1d": number; "7d": number; "30d": number };
  notes: Record<NoteKind, { count: number; bytes: number }>;
  /** null with licensing off: there is no cap and there are no licenses. */
  freeCap: { near: number; at: number; over: number } | null;
  licenses: { active: number; unattached: number; lapsed: number } | null;
};

/** Sets the usage gauges to a count that took `seconds`. They join the registry on the first count, so before it they are absent. */
export function usageCounted(c: UsageCount, seconds: number, now = Date.now()): void {
  if (!config.metrics()) return;
  const m = metrics();
  const u = m.usage;
  for (const g of Object.values(u)) {
    g.reset();
    const name = (g as unknown as { name: string }).name;
    if (!m.register.getSingleMetric(name)) m.register.registerMetric(g);
  }
  u.feeds.set(c.feeds);
  u.protected.set(c.protected);
  u.readLink.set(c.readLink);
  for (const [within, n] of Object.entries(c.active)) u.active.set({ within }, n);
  for (const [kind, n] of Object.entries(c.notes)) {
    u.notes.set({ kind }, n.count);
    u.bytes.set({ kind }, n.bytes);
  }
  if (c.freeCap) for (const [notes, n] of Object.entries(c.freeCap)) u.nearCap.set({ notes }, n);
  if (c.licenses) for (const [state, n] of Object.entries(c.licenses)) u.licenses.set({ state }, n);
  u.at.set(Math.floor(now / 1000));
  u.took.set(seconds);
}
