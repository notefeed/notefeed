// MCP sign-in (ADR 0062) through Better Auth's OAuth server (the `mcp` plugin, auth.ts), which issues the tokens; this is what
// notefeed adds around it. Discovery at the addresses MCP clients look in, the protected resource's metadata (the plugin serves
// none under Next), and the authorize page's answer: with accounts, the signed-in account's Allow or Deny; on an instance the
// password locks, the password, for the one user that stands for the instance. The authorize and token steps themselves are
// Better Auth's. On an open instance without accounts every handler here is 404.
import { oauthProviderAuthServerMetadata, verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { readFields, sameOrigin, seeOther } from "../http/request";
import { logger } from "../log";
import { makeSignature } from "better-auth/crypto";
import { checkPassword } from "../auth";
import { AuthError, NotefeedError, RateLimitedError } from "../errors";
import { clientIp } from "../limits";
import { accountsAuth, instanceUser, MCP_SCOPES, oauthAuth, signedInSession, type Auth } from "./auth";
import { config } from "../config";

const log = logger("oauth");
const cors = { "Access-Control-Allow-Origin": "*" };
// What the metadata names but notefeed doesn't serve: introspection needs a confidential client, which no MCP client is.
const UNSERVED = ["introspection_endpoint", "introspection_endpoint_auth_methods_supported", "introspection_endpoint_auth_signing_alg_values_supported"];

const notFound = () => new Response("not found", { status: 404 });
// Every handler here: 404 on an open instance without accounts, else the handler with the OAuth server's instance.
const withOAuth =
  <A extends unknown[], R extends Response | Promise<Response>>(handler: (auth: Auth, ...args: A) => R) =>
  (...args: A): R | Response => {
    const auth = oauthAuth();
    return auth ? handler(auth, ...args) : notFound();
  };

// RFC 8414, at /.well-known/oauth-authorization-server and below it the issuer's path (/api/auth).
export const authServerRoute = withOAuth(async (auth, req: Request): Promise<Response> => {
  const res = await oauthProviderAuthServerMetadata(auth)(req);
  const body = (await res.json()) as Record<string, unknown>;
  for (const k of UNSERVED) delete body[k];
  return Response.json(body, { status: res.status, headers: cors });
});

// RFC 9728: /mcp, whose tokens Better Auth issues.
export const protectedResourceRoute = withOAuth((): Response => {
  const base = config.publicUrl();
  return Response.json(
    { resource: `${base}/mcp`, authorization_servers: [`${base}/api/auth`], bearer_methods_supported: ["header"], scopes_supported: MCP_SCOPES },
    { headers: cors },
  );
});

// The authorize request Better Auth signed for the page (its query without the page's own parameters), or null when it isn't one, was
// changed or has expired (10 minutes).
export async function oauthQuery(auth: Auth, params: URLSearchParams): Promise<string | null> {
  if (!params.has("sig")) return null;
  const q = new URLSearchParams(params);
  q.delete("error");
  const s = q.toString();
  return (await verifyOAuthQueryParams(s, (await auth.$context).secret)) ? s : null;
}

// The client asking, for the page: the name it gave and where the code goes. Read with the signed request, so also before sign-in. Its
// name is its own claim.
export async function oauthClient(auth: Auth, query: string): Promise<{ name: string; redirectHost: string } | null> {
  const params = new URLSearchParams(query);
  const clientId = params.get("client_id");
  const redirect = params.get("redirect_uri");
  if (!clientId || !redirect || !URL.canParse(redirect)) return null;
  const client = await auth.api.getOAuthClientPublicPrelogin({ body: { client_id: clientId, oauth_query: query } }).catch(() => null);
  if (!client) return null;
  const host = new URL(redirect).host;
  const name = typeof client.client_name === "string" && !/[\p{Cc}\p{Cf}]/u.test(client.client_name) ? client.client_name.slice(0, 100) : host;
  return { name, redirectHost: host };
}

// OPTIONS for the metadata documents, which browser-based MCP clients read cross-origin.
export const metadataPreflight = withOAuth(
  (): Response =>
    new Response(null, {
      status: 204,
      headers: { ...cors, "Access-Control-Allow-Methods": "GET", "Access-Control-Allow-Headers": "content-type, mcp-protocol-version" },
    }),
);

// POST /api/oauth/authorize: the page's form, from this instance's own pages. With accounts, Allow or Deny for the account signed in
// on them; without, the instance password. Better Auth checks the signed request again and answers with where the browser goes:
// the client, with a code or access_denied.
export const authorizeRoute = withOAuth(async (auth, req: Request): Promise<Response> => {
  const h = req.headers;
  if (!sameOrigin(h)) return new Response("forbidden", { status: 403 });
  const form = await readFields(req, 16 * 1024);
  const raw = form?.get("oauth_query");
  const query = typeof raw === "string" ? await oauthQuery(auth, new URLSearchParams(raw)) : null;
  if (!query) return expired();
  if (!accountsAuth()) return passwordAnswer(auth, query, String(form?.get("password") ?? ""), h);
  const session = await signedInSession(h);
  if (!session) return seeOther(`/oauth/authorize?${query}&error=auth`);
  const accept = form?.get("accept") === "1";
  const r = await auth.api.oauth2Consent({ body: { accept, oauth_query: query }, headers: h }).catch(() => null);
  if (!r?.url) return expired();
  log.info({ via: "account", accept }, accept ? "authorization granted" : "authorization denied"); // never who, never the client's name
  return seeOther(r.url);
});

// Back to the authorize page, which says in the reader's language that this sign-in has expired (t.login.expired).
const expired = () => seeOther("/oauth/authorize?error=expired");

// The instance password, checked like /login (the failed-attempt limit applies). Right, a session of the instance's user answers
// Better Auth's consent; it is never sent to the browser, and the client's grant hangs on it (the code's exchange wants it).
async function passwordAnswer(auth: Auth, query: string, password: string, h: Headers): Promise<Response> {
  try {
    checkPassword(password, clientIp(h));
  } catch (e) {
    if (!(e instanceof NotefeedError)) throw e;
    if (e instanceof AuthError) logger("auth").warn({ page: "authorize" }, "password login failed");
    const retry = e instanceof RateLimitedError ? `&retry=${e.retryAfter}` : "";
    return seeOther(`/oauth/authorize?${query}&error=${e.code}${retry}`);
  }
  const ctx = await auth.$context;
  const session = await ctx.internalAdapter.createSession(await instanceUser(auth), false);
  const cookie = `${ctx.authCookies.sessionToken.name}=${session.token}.${await makeSignature(session.token, ctx.secret)}`;
  const r = await auth.api.oauth2Consent({ body: { accept: true, oauth_query: query }, headers: new Headers({ cookie }) }).catch(() => null);
  if (!r?.url) return expired();
  log.info({ via: "password" }, "authorization granted"); // never the client's self-chosen name
  return seeOther(r.url);
}
