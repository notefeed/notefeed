// The account pages' own requests (ADR 0057), all from this instance's pages only (same origin), like the login form:
//   POST /api/accounts/create         a new account (accounts `open` only): JSON with the number and key, shown once; signs it in
//   POST /api/accounts/sign-in        the number and key from the login page's form: to `next`, or back to /login?error=
//   POST /api/accounts/recovery-key   signed in: a new recovery key, JSON, shown once; the old one stops working
//   POST /api/accounts/delete         signed in, with the number typed again: the account goes, and the browser is signed out
// Passkeys go through Better Auth's own endpoints (accounts/auth.ts, authRoute). A person's account actions over the API and MCP come
// with account tokens.
import { accountsAuth, signedInSession } from "../accounts/auth";
import { accountsMode, accountsOn } from "../accounts/mode";
import { accountNumber, createAccount, deleteAccount, formatNumber, newRecoveryKey, parseNumber, signInWithNumber } from "../accounts/numbers";
import { AuthError, NotefeedError, RateLimitedError, TooManyAttemptsError } from "../errors";
import { authAttempt, clientIp, rateLimit } from "../limits";
import { logger } from "../log";
import { safeNext } from "../urls";
import { FORM_WITH_SHARE_BYTES, readFields, sameOrigin, seeOther } from "./request";

const log = logger("accounts");
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
const notFound = () => json({ error: "not found" }, 404);
const forbidden = () => json({ error: "forbidden" }, 403);

export async function accountCreateRoute(req: Request): Promise<Response> {
  if (!accountsOn()) return notFound();
  if (!sameOrigin(req.headers) || accountsMode() !== "open") return forbidden();
  const wait = rateLimit(clientIp(req.headers));
  if (wait !== null) return json({ error: "rate limit exceeded" }, 429, { "Retry-After": String(wait) });
  const { number, recoveryKey } = await createAccount();
  const cookies = await signInWithNumber(number, recoveryKey, req.headers);
  log.info("account created"); // never which
  const res = json({ number: formatNumber(number), recoveryKey });
  for (const c of cookies) res.headers.append("Set-Cookie", c);
  return res;
}

export async function accountSignInRoute(req: Request): Promise<Response> {
  if (!accountsOn()) return notFound();
  if (!sameOrigin(req.headers)) return forbidden();
  const fields = await readFields(req, FORM_WITH_SHARE_BYTES); // `next` may carry a share from the start page
  const next = safeNext(fields?.get("next"));
  const back = (e: NotefeedError) =>
    seeOther(`/login?error=${e.code}${e instanceof RateLimitedError ? `&retry=${e.retryAfter}` : ""}${next === "/" ? "" : `&next=${encodeURIComponent(next)}`}`);
  const attempt = authAttempt(clientIp(req.headers));
  if (typeof attempt === "number") return back(new TooManyAttemptsError(attempt));
  try {
    const cookies = await signInWithNumber(String(fields?.get("number") ?? ""), String(fields?.get("recoveryKey") ?? ""), req.headers);
    attempt(); // a right key isn't a failure
    log.info({ via: "recovery key" }, "account signed in");
    const res = seeOther(next);
    for (const c of cookies) res.headers.append("Set-Cookie", c);
    return res;
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
    log.warn("account sign-in failed");
    return back(e);
  }
}

// The signed-in account of a request from this instance's own page, or the response refusing it.
async function signedIn(req: Request): Promise<{ userId: string } | Response> {
  if (!accountsOn()) return notFound();
  if (!sameOrigin(req.headers)) return forbidden();
  const session = await signedInSession(req.headers);
  return session ?? json({ error: "not signed in" }, 401);
}

export async function recoveryKeyRoute(req: Request): Promise<Response> {
  const who = await signedIn(req);
  if (who instanceof Response) return who;
  if (!(await accountNumber(who.userId))) return forbidden(); // an identity provider's account has no recovery key
  return json({ recoveryKey: await newRecoveryKey(who.userId) });
}

export async function accountDeleteRoute(req: Request): Promise<Response> {
  const who = await signedIn(req);
  if (who instanceof Response) return who;
  const fields = await readFields(req, 4096);
  const number = await accountNumber(who.userId);
  // The number typed again, so a stray click or a forged form can't delete it; an identity provider's account confirms with "delete".
  const confirmed = number ? parseNumber(String(fields?.get("confirm") ?? "")) === number : fields?.get("confirm") === "delete";
  if (!confirmed) return seeOther("/account?error=confirm");
  const out = await accountsAuth()!
    .api.signOut({ headers: req.headers, returnHeaders: true })
    .catch(() => null);
  await deleteAccount(who.userId);
  log.info("account deleted");
  const res = seeOther("/");
  for (const c of out?.headers.getSetCookie() ?? []) res.headers.append("Set-Cookie", c);
  return res;
}
