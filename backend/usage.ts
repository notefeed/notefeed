// The usage gauges of /metrics (ADR 0039): how many feeds, notes, bytes and licenses the instance holds. Counting is a pass over
// every feed (Storage.usage), so it runs at most once per USAGE_MAX_AGE_MS, never per scrape: a scrape that finds the count old
// starts the next one and answers with the last, and only the very first scrape waits for it. Counts only: nothing here leaves the
// process that names a feed, a read id or a license key.
import { config } from "./config";
import { licenses, licensingOn } from "./licensing";
import { logger } from "./log";
import { usageCounted, type UsageCount } from "./metrics";
import { typeForExt } from "./note/types";
import { processState } from "./state";
import { storage } from "./storage";
import type { SqlStorage } from "./storage/sql";
import type { FeedUsage } from "./storage/types";

export const USAGE_MAX_AGE_MS = 5 * 60_000;
const DAY_MS = 86_400_000;
/** A free feed this close to the cap counts as near it. */
const NEAR_CAP = 0.8;

const log = logger("usage");

/** The count of what `feeds` (Storage.usage) hold. `cap`: the free tier's note cap, null with licensing off. */
export function countUsage(feeds: FeedUsage[], cap: number | null, now = Date.now()): Omit<UsageCount, "licenses"> {
  const c: Omit<UsageCount, "licenses"> = { feeds: feeds.length, protected: 0, readLink: 0, active: { "1d": 0, "7d": 0, "30d": 0 }, notes: { markdown: { count: 0, bytes: 0 }, image: { count: 0, bytes: 0 } }, freeCap: cap === null ? null : { near: 0, at: 0, over: 0 } };
  for (const f of feeds) {
    if (f.protected) c.protected++;
    if (f.readLink) c.readLink++;
    if (f.lastWrite !== null) for (const [within, days] of [["1d", 1], ["7d", 7], ["30d", 30]] as const) if (f.lastWrite >= now - days * DAY_MS) c.active[within]++;
    let markdown = 0;
    for (const [ext, n] of Object.entries(f.notes)) {
      const kind = typeForExt(ext)?.name;
      if (!kind) continue; // a file that is not a note
      const k = (c.notes[kind] ??= { count: 0, bytes: 0 });
      k.count += n.count;
      k.bytes += n.bytes;
      if (kind === "markdown") markdown += n.count;
    }
    if (c.freeCap && cap !== null) {
      if (markdown > cap) c.freeCap.over++;
      else if (markdown === cap) c.freeCap.at++;
      else if (markdown >= Math.ceil(cap * NEAR_CAP)) c.freeCap.near++;
    }
  }
  return c;
}

const state = processState("usage", () => ({ at: -Infinity, counted: false }) as { at: number; counted: boolean; running?: Promise<void> });

async function count(): Promise<void> {
  const start = performance.now();
  const on = licensingOn();
  const s = storage();
  const database = config.storage() === "fs" ? null : (s as SqlStorage).databaseStats();
  const [feeds, held, db] = await Promise.all([s.usage(), on ? licenses().counts() : null, database]);
  usageCounted({ ...countUsage(feeds, on ? config.freeNoteCap() : null), licenses: held, database: db }, (performance.now() - start) / 1000);
  state.counted = true;
}

/** Before a scrape: starts a count when the last is older than USAGE_MAX_AGE_MS (one at a time) and waits only for the first. A failed
 *  count is logged and the gauges keep the last one; the next try is USAGE_MAX_AGE_MS later. */
export async function refreshUsage(now = Date.now()): Promise<void> {
  if (!config.metrics()) return;
  if (!state.running && now - state.at >= USAGE_MAX_AGE_MS) {
    state.at = now;
    state.running = count()
      .catch((err) => log.warn({ err }, "counting the usage for /metrics failed"))
      .finally(() => (state.running = undefined));
  }
  if (!state.counted) await state.running;
}

export const resetUsageForTests = (): void => {
  state.at = -Infinity;
  state.counted = false;
  state.running = undefined;
};
