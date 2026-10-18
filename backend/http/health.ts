// GET /health: is this instance able to answer? Each part it needs is asked once: the storage by a lookup, the image store (when
// NOTEFEED_IMAGES names one outside the database) and the key service (NOTEFEED_KMS) by their checks. 200 `{"status":"ok","checks":{…}}` when all answer, 503
// `{"status":"unavailable","checks":{…}}` when one does not, with `checks` saying which. Open and without a switch: it says nothing but
// that, and a probe has no credential. proxy.ts skips the lock for it, and the request log keeps it at `debug`
// (backend/http/requestlog.ts), so a failure is logged here.
import { logger } from "../log";
import { storage } from "../storage";
import { createImageStore } from "../storage/images";
import { keyServiceCheck } from "../storage/wrapper";

const log = logger("health");

type Check = "ok" | "unavailable";

async function check(msg: string, probe: () => Promise<unknown>): Promise<Check> {
  try {
    await probe();
    return "ok";
  } catch (e) {
    log.error({ err: e }, msg);
    return "unavailable";
  }
}

// One lookup by name: a row by its key in a database, the feed index in memory on the file system. `health` is never a feed.
const storageCheck = () => check("storage check failed", () => storage().feedReadId("health"));

// Only for an instance that has an image store; a wrong setting of it already fails the storage check.
function imagesCheck(): Promise<Check> | undefined {
  let store: ReturnType<typeof createImageStore>;
  try {
    store = createImageStore();
  } catch {
    return undefined;
  }
  return store ? check("image store check failed", () => store.check()) : undefined;
}

export async function healthRoute(): Promise<Response> {
  const keyService = keyServiceCheck();
  const [storageState, images, keys] = await Promise.all([storageCheck(), imagesCheck(), keyService && check("key service check failed", keyService)]);
  const checks = { storage: storageState, ...(images && { images }), ...(keys && { keys }) };
  const ok = Object.values(checks).every((c) => c === "ok");
  return Response.json({ status: ok ? "ok" : "unavailable", checks }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
