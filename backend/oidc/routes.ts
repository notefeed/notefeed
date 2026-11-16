// GET /api/oidc/start and GET /api/oidc/finish: sign-in through one of the operator's OIDC providers, run by Better Auth
// (backend/accounts). start checks the request as before and hands the browser to Better Auth's sign-in with two return
// addresses on this instance: finish on success and on failure. Where to go afterwards (next) rides along signed, so finish can't be
// pointed elsewhere. An MCP client's sign-in comes here like any other, with next back to its authorize page (ADR 0062). 404 while
// the mode is off.
import { accountsAuth, signedInSession } from "../accounts/auth";
import { AuthError } from "../errors";
import { cookie, seeOther } from "../http/request";
import { authFailed, authWait, clientIp } from "../limits";
import { type Payloads, sign, TTL, verify } from "../signed";
import { publicUrl, safeNext } from "../urls";
import { safeEqual } from "../auth";
import { randomBytes } from "node:crypto";
import { identityOn, type Provider, providerById, providers } from "./config";
import { errorCode, log, logFailure, logUrl } from "./log";

type Flight = Payloads["oidc"];

// TLS to the provider: https anywhere, plain http only on loopback (a provider on this machine). No fragment.
function issuerOk(u: string): boolean {
  if (u.length > 512 || u.includes("#") || !URL.canParse(u)) return false;
  const { protocol, hostname } = new URL(u);
  return protocol === "https:" || (protocol === "http:" && (hostname === "localhost" || hostname === "127.0.0.1"));
}
const notFound = () => new Response("not found", { status: 404 });

// The browser that started a sign-in holds its nonce in this cookie; finish takes a flight only together with it, so a finish link
// cut out of someone else's sign-in can't issue a code for whoever is signed in where it is opened.
const FLIGHT_COOKIE = "nf_oidc";
function flightCookie(h: Headers, value: string, maxAge: number): string {
  const secure = publicUrl(h).startsWith("https:") ? "; Secure" : "";
  return `${FLIGHT_COOKIE}=${value}; Path=/api/oidc; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

// Back to the login page, keeping next.
function failedPage(from: { next?: string } | null, error: string): string {
  const next = safeNext(from?.next);
  return `/login?error=${error}${next === "/" ? "" : `&next=${encodeURIComponent(next)}`}`;
}

// The provider a start names (by id); with only one configured, naming none means that one.
function chosen(id: string | null): Provider | undefined {
  if (id) return providerById(id);
  const all = providers();
  return all.length === 1 ? all[0] : undefined;
}

// The login page's plain link (?provider=&next=).
function startRequest(req: Request): { next: string; provider: string | null } {
  const params = new URL(req.url).searchParams;
  return { next: safeNext(params.get("next")), provider: params.get("provider") };
}

const finishUrl = (flight: Flight, failed: boolean) =>
  `/api/oidc/finish?${new URLSearchParams({ f: sign("oidc", flight), ...(failed ? { failed: "1" } : {}) })}`;

export async function oidcStartRoute(req: Request): Promise<Response> {
  const auth = accountsAuth();
  if (!identityOn() || !auth) return notFound();
  const start = startRequest(req);
  const { next } = start;
  const wait = authWait(clientIp(req.headers));
  if (wait !== null) return seeOther(failedPage({ next }, `too_many_attempts&retry=${wait}`));
  const provider = chosen(start.provider);
  // A missing or unknown provider: back where the sign-in started, with nothing fetched.
  if (!provider) {
    // The id only when it has a provider id's shape: requested text is never echoed.
    logFailure("unknown provider", /^[a-z0-9_]{1,64}$/.test(start.provider ?? "") ? { provider: start.provider! } : {});
    return seeOther(failedPage({ next }, "sign_in_failed"));
  }
  // TLS to the provider: https, or plain http on loopback only (as for redirect URIs).
  if (!issuerOk(provider.issuer)) {
    logFailure("issuer is not an https URL", { provider: provider.id, issuer: logUrl(provider.issuer) });
    return seeOther(failedPage({ next }, "sign_in_failed"));
  }
  const flight: Flight = { provider: provider.id, nonce: randomBytes(16).toString("base64url"), next };
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
    return seeOther(failedPage({ next }, "sign_in_failed"));
  }
}

// Throws AuthError unless the sign-in worked and the flight is ours.
async function signIn(params: URLSearchParams, flight: Flight | null, h: Headers): Promise<void> {
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
  if (!session?.name) {
    logFailure("no session after the sign-in", { provider: flight.provider });
    throw new AuthError();
  }
}

// Every failure counts toward the failed-password limit.
export async function oidcFinishRoute(req: Request): Promise<Response> {
  if (!identityOn()) return notFound();
  const h = req.headers;
  const ip = clientIp(h);
  const params = new URL(req.url).searchParams;
  const flight = verify("oidc", params.get("f") ?? "");
  try {
    await signIn(params, flight, h);
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
    authFailed(ip);
    return seeOther(failedPage(flight, "sign_in_failed"), { "Set-Cookie": flightCookie(h, "", 0) });
  }
  log.info({ provider: flight!.provider }, "sign-in succeeded"); // which provider, never who
  return seeOther(safeNext(flight!.next), { "Set-Cookie": flightCookie(h, "", 0) });
}
