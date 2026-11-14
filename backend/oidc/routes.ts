// GET /api/oidc/start and GET /api/oidc/finish: sign-in through one of the operator's OIDC providers, run by Better Auth
// (backend/accounts). start checks the request as before and hands the browser to Better Auth's sign-in with two return
// addresses on this instance: finish on success and on failure. Where to go afterwards (next, or an MCP client's checked authorize
// fields) rides along signed, so finish can't be pointed elsewhere. finish turns a Better Auth session into what started the
// sign-in: back to next, or, for an MCP authorize request, a code for the client carrying the sender. 404 while the mode is off.
import { accountsAuth, signedInSession } from "../accounts/auth";
import { AuthError } from "../errors";
import { cookie, readFields, sameOrigin, seeOther } from "../http/request";
import { authFailed, authWait, clientIp } from "../limits";
import { logger } from "../log";
import { checkAuthorize, issueCode, redirectUriOk } from "../oauth/routes";
import { type Payloads, sign, TTL, verify } from "../oauth/tokens";
import { publicUrl, safeNext } from "../urls";
import { safeEqual } from "../auth";
import { randomBytes } from "node:crypto";
import { identityOn, type Provider, providerById, providers } from "./config";
import { errorCode, log, logFailure, logUrl } from "./log";

type Flight = Payloads["oidc"];
const notFound = () => new Response("not found", { status: 404 });

// The browser that started a sign-in holds its nonce in this cookie; finish takes a flight only together with it, so a finish link
// cut out of someone else's sign-in can't issue a code for whoever is signed in where it is opened.
const FLIGHT_COOKIE = "nf_oidc";
function flightCookie(h: Headers, value: string, maxAge: number): string {
  const secure = publicUrl(h).startsWith("https:") ? "; Secure" : "";
  return `${FLIGHT_COOKIE}=${value}; Path=/api/oidc; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

// Where the sign-in started: the MCP client's authorize page, or the login page keeping next.
function failedPage(from: { next?: string; authorize?: Record<string, string> } | null, error: string): string {
  const next = safeNext(from?.next);
  return from?.authorize
    ? `/oauth/authorize?${new URLSearchParams(from.authorize)}&error=${error}`
    : `/login?error=${error}${next === "/" ? "" : `&next=${encodeURIComponent(next)}`}`;
}

// The provider a start names (by id); with only one configured, naming none means that one.
function chosen(id: string | null): Provider | undefined {
  if (id) return providerById(id);
  const all = providers();
  return all.length === 1 ? all[0] : undefined;
}

// Any of these on the GET means an MCP authorize request, which must come as the POST.
const MCP_FIELDS = ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "state", "resource"];

// GET: the login page's plain link (?provider=&next=). POST: the MCP authorize page's form, from this instance's own pages
// only. There is no other consent step, so a cross-site navigation must never get a code issued for a client the
// person never saw (open registration lets anyone register one); only checkAuthorize's fields are kept.
async function startRequest(req: Request): Promise<{ next: string; authorize?: Record<string, string>; provider: string | null } | Response> {
  const h = req.headers;
  if (req.method !== "POST") {
    const params = new URL(req.url).searchParams;
    if (MCP_FIELDS.some((k) => params.has(k))) return new Response("An MCP sign-in starts from the authorize page's form.", { status: 400 });
    return { next: safeNext(params.get("next")), provider: params.get("provider") };
  }
  if (!sameOrigin(h)) return new Response("forbidden", { status: 403 });
  const params = new URLSearchParams();
  for (const [k, v] of (await readFields(req, 16 * 1024)) ?? []) if (typeof v === "string") params.append(k, v);
  const checked = checkAuthorize(params, h);
  if (checked.kind === "redirect") return seeOther(checked.location);
  if (checked.kind === "error") return new Response(checked.message, { status: 400 });
  return { next: "/", authorize: checked.fields, provider: params.get("provider") };
}

const finishUrl = (flight: Flight, failed: boolean) =>
  `/api/oidc/finish?${new URLSearchParams({ f: sign("oidc", flight), ...(failed ? { failed: "1" } : {}) })}`;

export async function oidcStartRoute(req: Request): Promise<Response> {
  const auth = accountsAuth();
  if (!identityOn() || !auth) return notFound();
  const start = await startRequest(req);
  if (start instanceof Response) return start;
  const { next, authorize } = start;
  const wait = authWait(clientIp(req.headers));
  if (wait !== null) return seeOther(failedPage({ next, authorize }, `too_many_attempts&retry=${wait}`));
  const provider = chosen(start.provider);
  // A missing or unknown provider: back where the sign-in started, with nothing fetched.
  if (!provider) {
    // The id only when it has a provider id's shape: requested text is never echoed.
    logFailure("unknown provider", /^[a-z0-9_]{1,64}$/.test(start.provider ?? "") ? { provider: start.provider! } : {});
    return seeOther(failedPage({ next, authorize }, "sign_in_failed"));
  }
  // TLS to the provider: https, or plain http on loopback only (as for redirect URIs).
  if (!redirectUriOk(provider.issuer)) {
    logFailure("issuer is not an https URL", { provider: provider.id, issuer: logUrl(provider.issuer) });
    return seeOther(failedPage({ next, authorize }, "sign_in_failed"));
  }
  const flight: Flight = { provider: provider.id, nonce: randomBytes(16).toString("base64url"), next, ...(authorize ? { authorize } : {}) };
  try {
    const { headers, response } = await auth.api.signInSocial({
      body: { provider: provider.id, callbackURL: finishUrl(flight, false), errorCallbackURL: finishUrl(flight, true), disableRedirect: true },
      headers: req.headers,
      returnHeaders: true,
    });
    if (!response?.url) throw new Error("no authorization URL");
    const res = seeOther(response.url, { "Set-Cookie": flightCookie(req.headers, flight.nonce, TTL.oidc) });
    for (const c of headers.getSetCookie()) res.headers.append("Set-Cookie", c);
    return res;
  } catch (e) {
    // Discovery failed, or the provider's configuration is unusable: Better Auth has logged its detail.
    logFailure("discovery failed", { provider: provider.id, ...(e instanceof Error ? { error: e.name } : {}) });
    return seeOther(failedPage({ next, authorize }, "sign_in_failed"));
  }
}

// Throws AuthError unless the sign-in worked and the flight is ours; returns the sender and the Better Auth user id.
async function signIn(params: URLSearchParams, flight: Flight | null, h: Headers): Promise<{ sender: string; uid: string }> {
  const nonce = cookie(h, FLIGHT_COOKIE);
  if (!flight || !nonce || typeof flight.nonce !== "string" || !safeEqual(nonce, flight.nonce)) {
    logFailure("state mismatch or missing sign-in cookie");
    throw new AuthError();
  }
  if (params.has("failed")) {
    // Better Auth's reason (`unable_to_get_user_info` after a refusal logged in accounts/providers.ts, `invalid_code`, …).
    logFailure("provider sign-in failed", { provider: flight.provider, ...errorCode(params.get("error")) });
    throw new AuthError();
  }
  const session = await signedInSession(h);
  if (!session) {
    logFailure("no session after the sign-in", { provider: flight.provider });
    throw new AuthError();
  }
  return { sender: session.name, uid: session.userId };
}

// Every failure counts toward the failed-password limit.
export async function oidcFinishRoute(req: Request): Promise<Response> {
  if (!identityOn()) return notFound();
  const h = req.headers;
  const ip = clientIp(h);
  const params = new URL(req.url).searchParams;
  const flight = verify("oidc", params.get("f") ?? "");
  let signedIn: { sender: string; uid: string };
  try {
    signedIn = await signIn(params, flight, h);
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
    authFailed(ip);
    return seeOther(failedPage(flight, "sign_in_failed"), { "Set-Cookie": flightCookie(h, "", 0) });
  }
  log.info({ provider: flight!.provider }, "sign-in succeeded"); // which provider, never who
  const done = (res: Response) => (res.headers.append("Set-Cookie", flightCookie(h, "", 0)), res);
  if (!flight!.authorize) return done(seeOther(safeNext(flight!.next)));
  logger("oauth").info({ via: flight!.provider }, "authorization granted");
  return done(issueCode(flight!.authorize, h, signedIn));
}
