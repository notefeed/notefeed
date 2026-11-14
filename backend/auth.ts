// Who may use the instance. The optional password (NOTEFEED_PASSWORD) is the bearer for scripts and, as an HMAC
// cookie (nf_session), the UI's password session. Optional sign-in (backend/oidc, run by Better Auth in backend/accounts) gives
// a Better Auth session naming the person. Either one locks the instance; with neither set it is open and every check passes.
// ponytail: the session is HMAC(secret, password): no expiry, logout only drops the browser's copy;
// a leaked cookie works until the password changes (see docs/self-hosting/access.md). Add an expiry to the signed value if that matters.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config";
import { AuthError, TooManyAttemptsError } from "./errors";
import { authFailed, authWait } from "./limits";
import { logger } from "./log";
import { secret } from "./secret";
import { signedInName, signedInSession } from "./accounts/auth";
import { identityOn } from "./oidc/config";

const log = logger("auth");

export const SESSION_COOKIE = "nf_session";

// Locked by a password, by sign-in, or both. Sign-in without a password is locked too: an unset password never matches.
export const locked = () => config.password() !== "" || identityOn();

// Hash both sides so lengths match and timingSafeEqual never throws.
export function safeEqual(a: string, b: string): boolean {
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(a), h(b));
}

// Over the failed-attempt limit the password is not even compared; only failures are counted.
export function checkPassword(candidate: string, ip: string): void {
  const wait = authWait(ip);
  if (wait !== null) throw new TooManyAttemptsError(wait);
  if (config.password() === "") throw new AuthError();
  if (safeEqual(candidate, config.password())) return;
  authFailed(ip);
  throw new AuthError();
}

// The token of `Authorization: Bearer <token>` (scheme in any case, RFC 9110), or "" when there is none.
export const bearerOf = (authorization: string | null): string => /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1] ?? "";

// `Authorization: Bearer <password>` on a locked instance; anything passes on an open one.
export function checkBearer(authorization: string | null, ip: string): void {
  if (!locked()) return;
  try {
    checkPassword(bearerOf(authorization), ip);
  } catch (e) {
    if (e instanceof AuthError) log.debug("password bearer refused");
    throw e;
  }
}

// The password session's cookie value: the password under the server secret, so a leaked cookie gives nothing to guess the
// password from offline without the secret too (#374). Changing either signs every password session out.
const sessionValue = () =>
  createHmac("sha256", secret()).update("notefeed-session\0").update(createHash("sha256").update(config.password()).digest()).digest("hex");

// The login form: returns the session cookie's value. An open instance has no password to log in with.
export function login(password: string, ip: string): string {
  if (!locked()) throw new AuthError();
  try {
    checkPassword(password, ip);
  } catch (e) {
    if (e instanceof AuthError) log.warn({ page: "login" }, "password login failed"); // not the too-many-attempts refusals
    throw e;
  }
  log.info({ page: "login" }, "password login succeeded");
  return sessionValue();
}

// The value of cookie `name` in a Cookie header, or undefined.
export function cookieOf(h: Headers, name: string): string | undefined {
  for (const part of (h.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

// A password session (only when a password is set) or a Better Auth session, from the request's cookies, with the cookies that
// renew a Better Auth session (the proxy passes them on with a page). Which requests may use a cookie at all (same origin, no
// Authorization header) is the caller's rule.
export async function sessionCheck(h: Headers): Promise<{ ok: boolean; setCookies: string[] }> {
  if (!locked()) return { ok: true, setCookies: [] };
  const cookie = cookieOf(h, SESSION_COOKIE);
  if (config.password() !== "" && cookie !== undefined && safeEqual(cookie, sessionValue())) return { ok: true, setCookies: [] };
  const signed = await signedInSession(h);
  return { ok: signed !== undefined, setCookies: signed?.setCookies ?? [] };
}

export const sessionOk = async (h: Headers): Promise<boolean> => (await sessionCheck(h)).ok;

// Whether a person is signed in through a provider (the compose box says their name is shown).
export const signedIn = async (h: Headers): Promise<boolean> => identityOn() && (await signedInName(h)) !== undefined;
