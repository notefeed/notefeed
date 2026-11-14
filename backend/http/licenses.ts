// The payment provider's webhook (ADR 0029, ADR 0061). Under /api, which proxy.ts leaves to its handlers, and not in the public API
// description (as the operator's are): it is the provider's.
//   POST   /api/licenses/webhook   the provider's events; signed, answered 200 once applied, 400 for a bad signature
// 404 while no payment provider is configured. Buying, the units and the portal are the account's, in the public API (/api/v1/account/license).
import { NotefeedError, RateLimitedError } from "../errors";
import { receiveWebhook, WebhookRejectedError } from "../licenseflow";
import { licensingOn } from "../licensing";
import { logger } from "../log";
import { statusOf } from "./errors";
import { readCapped } from "./request";

const log = logger("licenses");

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
const off = () => json({ error: "licenses are not sold on this instance" }, 404);

function failed(e: unknown): Response {
  if (e instanceof NotefeedError)
    return json({ error: e.message, code: e.code }, statusOf(e), e instanceof RateLimitedError ? { "Retry-After": String(e.retryAfter) } : {});
  log.error({ err: e }, "a license request failed");
  return json({ error: "internal error" }, 500);
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
