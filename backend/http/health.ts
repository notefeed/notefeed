// GET /health: is this instance able to answer? 200 `{"status":"ok"}` when the storage answers a lookup, 503 `{"status":"unavailable"}`
// when it throws (the database is away, DATA_DIR cannot be read). Open and without a switch: it says nothing but that, and a probe
// has no credential. proxy.ts skips the lock for it, and the request log keeps it at `debug` (backend/http/requestlog.ts), so a
// failure is logged here.
import { logger } from "../log";
import { storage } from "../storage";

const log = logger("health");

const reply = (status: number, body: { status: string }) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function healthRoute(): Promise<Response> {
  try {
    // One lookup by name: a row by its key in a database, the feed index in memory on the file system. `health` is never a feed.
    await storage().feedReadId("health");
  } catch (e) {
    log.error({ err: e }, "storage check failed");
    return reply(503, { status: "unavailable" });
  }
  return reply(200, { status: "ok" });
}
