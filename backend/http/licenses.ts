// The license endpoints of the SaaS (ADR 0029). Under /api, which proxy.ts leaves to its handlers, and not in the public API
// description (as the operator's are): they are for notefeed.me's own pages and for the payment provider.
//   POST   /api/licenses/checkout  the URL to send a buyer to (the key comes back in the fragment of the success page)
//   POST   /api/licenses/webhook   the provider's events; signed, answered 200 once applied, 400 for a bad signature
//   POST   /api/licenses/attach    {"feed", "key"} puts the license on the feed; needs write access to the feed
//   DELETE /api/licenses/attach    {"feed"} takes the license off; needs write access to the feed
// All of them are 404 while no payment provider is configured.
import { NotefeedError, NotFoundError, RateLimitedError } from "../errors";
import { checkFeedAccess } from "../feedlock";
import { checkFeed } from "../feednames";
import { attachLicense, detachLicense, receiveWebhook, startCheckout, WebhookRejectedError } from "../licenseflow";
import { licensingOn } from "../licensing";
import { clientIp, rateLimit } from "../limits";
import { logger } from "../log";
import { statusOf } from "./errors";
import { feedAccess, readCapped } from "./request";

const log = logger("licenses");
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
const off = () => json({ error: "licenses are not sold on this instance" }, 404);

async function body(req: Request, max: number): Promise<Record<string, unknown>> {
  const bytes = await readCapped(req, max);
  try {
    const v = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes ?? new Uint8Array()));
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function failed(e: unknown): Response {
  if (e instanceof NotefeedError) return json({ error: e.message, code: e.code }, statusOf(e), e instanceof RateLimitedError ? { "Retry-After": String(e.retryAfter) } : {});
  log.error({ err: e }, "a license request failed");
  return json({ error: "internal error" }, 500);
}

export async function checkoutRoute(req: Request): Promise<Response> {
  if (!licensingOn()) return off();
  try {
    const wait = rateLimit(clientIp(req.headers));
    if (wait !== null) throw new RateLimitedError(wait);
    return json(await startCheckout());
  } catch (e) {
    return failed(e);
  }
}

export async function webhookRoute(req: Request): Promise<Response> {
  if (!licensingOn()) return off();
  const raw = new TextDecoder().decode((await readCapped(req, 256 * 1024)) ?? new Uint8Array());
  try {
    await receiveWebhook(raw, req.headers);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof WebhookRejectedError) {
      log.warn({ why: e.message }, "a webhook was rejected");
      return json({ error: "rejected" }, 400);
    }
    return failed(e); // a failure of ours is a 5xx, so the provider delivers the event again
  }
}

export async function attachRoute(req: Request): Promise<Response> {
  if (!licensingOn()) return off();
  try {
    const ip = clientIp(req.headers);
    const b = await body(req, 4096);
    const feed = typeof b.feed === "string" ? b.feed : "";
    if (checkFeed(feed)) throw new NotFoundError("no such feed");
    await checkFeedAccess(feed, feedAccess(req.headers, feed), ip);
    if (req.method === "DELETE") {
      await detachLicense(feed);
      return json({ ok: true });
    }
    await attachLicense(feed, typeof b.key === "string" ? b.key.trim() : "");
    return json({ ok: true });
  } catch (e) {
    return failed(e);
  }
}
