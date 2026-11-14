// POST /login (proxy.ts rewrites it to /api/login) and POST /logout: the web UI's plain login and
// logout forms. Both answer with a redirect, for browsers and scripts alike.
import { accountsAuth } from "../accounts/auth";
import { SESSION_COOKIE, locked, login } from "../auth";
import { NotefeedError, RateLimitedError } from "../errors";
import { clientIp } from "../limits";
import { publicUrl, safeNext } from "../urls";
import { FORM_WITH_SHARE_BYTES, parseForm, readCapped, seeOther } from "./request";

const YEAR = 60 * 60 * 24 * 365;

export async function loginRoute(req: Request): Promise<Response> {
  const h = req.headers;
  const bytes = await readCapped(req, FORM_WITH_SHARE_BYTES); // `next` may carry a share from the start page
  const form = bytes ? await parseForm(bytes, h).catch(() => null) : null;
  const next = safeNext(form?.get("next"));
  try {
    const session = login(String(form?.get("password") ?? ""), clientIp(h));
    const secure = publicUrl(h).startsWith("https:") ? "; Secure" : "";
    return seeOther(next, { "Set-Cookie": `${SESSION_COOKIE}=${session}; Path=/; Max-Age=${YEAR}; HttpOnly; SameSite=Lax${secure}` });
  } catch (e) {
    if (!(e instanceof NotefeedError)) throw e;
    const retry = e instanceof RateLimitedError ? `&retry=${e.retryAfter}` : "";
    return seeOther(`/login?error=${e.code}${retry}&next=${encodeURIComponent(next)}`);
  }
}

// Ends the password session and a Better Auth one (deleted from accounts.sqlite, its cookies cleared). Relative Location, so it
// stays correct behind a reverse proxy.
export async function logoutRoute(req?: Request): Promise<Response> {
  const res = seeOther(locked() ? "/login" : "/", { "Set-Cookie": `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax` });
  const auth = accountsAuth();
  if (auth && req) {
    const out = await auth.api.signOut({ headers: req.headers, returnHeaders: true }).catch(() => null);
    for (const c of out?.headers.getSetCookie() ?? []) res.headers.append("Set-Cookie", c);
  }
  return res;
}
