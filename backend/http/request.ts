// Reading requests, for the handlers in backend/http.
import { AuthError, NotefeedError, RateLimitedError, ReadOnlyTokenError } from "../errors";
import { signedInName, signedInSession } from "../accounts/auth";
import { TOKEN_PREFIX, tokenAccount } from "../accounts/tokens";
import { requestScope } from "../requestscope";
import { bearerOf, checkBearer, cookieOf, locked, sessionOk } from "../auth";
import { type FeedAccess, feedCookieName } from "../feedlock";
import { assertFeed } from "../feeds";
import { clientIp } from "../limits";
import { identityOn } from "../oidc/config";
import { verify } from "../oauth/tokens";
import { publicUrl } from "../urls";
import { errorResponse } from "./errors";

// The cap for the web UI's plain forms that carry what was shared to notefeed (shared/share.ts): the login's `next` and the
// unlock form's `share`. A share arrives in a URL, which Node takes up to 16 KiB of headers for; in a form body it is
// percent-encoded once more, at most three times as long.
export const FORM_WITH_SHARE_BYTES = 4096 + 3 * 16 * 1024;

// Reads at most `max` bytes; null (and the stream cancelled) as soon as the body is larger. A body that ends
// before the Content-Length it declared was cut short on its way (a proxy's buffer limit, a dropped
// connection): null too, so it is never stored. Content-Length can be absent (chunked) or too large for
// the cap's sake, so it is never trusted for the cap. The chunks are kept as they come and joined at the end, so a
// small body costs its own size, not the cap (a multipart post's is about 50 to 100 MB).
export async function readCapped(req: Request, max: number): Promise<Uint8Array | null> {
  const declared = req.headers.get("content-length");
  if (Number(declared) > max) return null;
  if (!req.body) return declared !== null && Number(declared) > 0 ? null : new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = req.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  if (declared !== null && size < Number(declared)) return null;
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

// The content type without parameters, lower case; "" when absent.
export const mediaType = (h: Headers) => (h.get("content-type") ?? "").split(";")[0].trim().toLowerCase();

// Form fields from an already-read body (multipart or urlencoded), parsed by the platform.
export const parseForm = (bytes: Uint8Array, h: Headers) =>
  new Response(bytes as BodyInit, { headers: { "content-type": h.get("content-type") ?? "" } }).formData();

// A small form post's fields; null when the body is too large or not a form.
export async function readFields(req: Request, max: number): Promise<FormData | null> {
  const bytes = await readCapped(req, max);
  return bytes ? parseForm(bytes, req.headers).catch(() => null) : null;
}

export const cookie = cookieOf;

// A browser on this instance's own pages: the Origin's host is the public host. Browsers send Origin
// on every POST, so a missing one is not same-origin.
export function sameOrigin(h: Headers): boolean {
  const origin = h.get("origin");
  return origin !== null && URL.canParse(origin) && new URL(origin).host === new URL(publicUrl(h)).host;
}

// `headers` may repeat a name (two Set-Cookie).
export function seeOther(location: string, headers: HeadersInit = {}): Response {
  const h = new Headers(headers);
  h.set("Location", location);
  return new Response(null, { status: 303, headers: h });
}

// A refused form post goes back to `page` (which may have a query) with error=<code>[&retry=n]; anything but
// a domain error is a bug.
export function errorRedirect(page: string, e: unknown): Response {
  if (!(e instanceof NotefeedError)) throw e;
  const retry = e instanceof RateLimitedError ? `&retry=${e.retryAfter}` : "";
  const [path, hash] = page.split("#"); // the query goes before a fragment such as #access
  return seeOther(`${path}${path.includes("?") ? "&" : "?"}error=${e.code}${retry}${hash ? `#${hash}` : ""}`);
}

// Scripts send the bearer password. The web UI sends a session cookie (password or Better Auth) instead, accepted only from
// this instance's own pages: a cross-site form would carry no cookie (SameSite=Lax), and the Origin
// check covers browsers that would. Throws AuthError or TooManyAttemptsError.
export async function authorize(h: Headers, ip: string): Promise<void> {
  if (!locked()) return;
  if (!h.has("authorization") && sameOrigin(h) && (await sessionOk(h))) return;
  // An account token (#390) on an instance accounts lock; a wrong one falls through and counts as a failed attempt below.
  const bearer = bearerOf(h.get("authorization"));
  if (bearer.startsWith(TOKEN_PREFIX) && (await tokenAccount(bearer))) return;
  checkBearer(h.get("authorization"), ip);
}

// The account behind a request, or undefined: an account token as the bearer (REST only, #390; a read token on a request that writes
// is refused), or else a session from this instance's own pages (honoured like the instance's own cookie: same origin, no
// Authorization header).
export async function requestAccount(h: Headers): Promise<string | undefined> {
  const bearer = bearerOf(h.get("authorization"));
  if (bearer.startsWith(TOKEN_PREFIX)) {
    const t = await tokenAccount(bearer);
    if (!t) return undefined;
    // Only a request known to be a GET (or HEAD) reads: a route outside the REST dispatcher notes no method, and counts as a write.
    const method = requestScope()?.method;
    if (!t.write && method !== "GET" && method !== "HEAD") throw new ReadOnlyTokenError();
    return t.userId;
  }
  return sessionAccount(h);
}

// The account signed in on this instance's own pages, never a token: for what a token may not do (making tokens).
export async function sessionAccount(h: Headers): Promise<string | undefined> {
  if (h.has("authorization") || !sameOrigin(h)) return undefined;
  return (await signedInSession(h))?.userId;
}

// The feed password header, or (like the instance cookie) the feed's unlock cookie from this instance's own pages, and the account
// signed in there (an owner passes without a password, ADR 0059). An empty header is no header: that is what curl sends for
// -H "X-Feed-Password: $UNSET" (nothing at all).
export async function feedAccess(h: Headers, feed: string): Promise<FeedAccess> {
  const password = h.get("x-feed-password") || undefined;
  const cookieOk = password === undefined && sameOrigin(h);
  const account = await requestAccount(h);
  return { password, cookie: cookieOk ? cookie(h, feedCookieName(feed)) : undefined, ...(account ? { account } : {}) };
}

// One of the web UI's plain forms for changing a feed or a note. Runs `act` once the post is known to come from
// this instance's own page by someone who may use the instance; a refusal goes back to `page`. `onGone` answers
// when the thing is already deleted (a double click): the goal is met.
export async function formPost(
  req: Request,
  feed: string,
  page: string,
  act: (h: Headers, ip: string) => Promise<Response>,
  onGone?: () => Response,
): Promise<Response> {
  const h = req.headers;
  try {
    assertFeed(feed); // before anything touches the disk
    // Only this instance's own pages may send these: another site's form must not change anything with a visitor's cookies.
    if (!sameOrigin(h)) throw new AuthError();
    const ip = clientIp(h);
    await authorize(h, ip);
    return await act(h, ip);
  } catch (e) {
    if (!(e instanceof NotefeedError)) throw e;
    if (["invalid_feed", "reserved_feed"].includes(e.code)) return errorResponse(e);
    if (e.code === "not_found" && onGone) return onGone();
    return errorRedirect(page, e);
  }
}

// The signed-in sender of a request, or undefined: from the Better Auth session, honoured like the session cookie
// in authorize (same origin, no Authorization header), or from an unexpired OAuth access token. Only while
// sign-in is on. Callers must already have checked the access token's audience.
export async function sender(h: Headers): Promise<string | undefined> {
  if (!identityOn()) return undefined;
  if (!h.has("authorization")) return sameOrigin(h) ? signedInName(h) : undefined;
  return verify("access", bearerOf(h.get("authorization")))?.sender;
}
