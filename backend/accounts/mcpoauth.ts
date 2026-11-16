// MCP sign-in where there are accounts (ADR 0062): Better Auth's OAuth server (the `mcp` plugin, auth.ts) issues the tokens; this is
// what notefeed adds around it. Discovery at the addresses MCP clients look in, the protected resource's metadata (the plugin
// serves none under Next), and the authorize page's answer (consent). The authorize and token steps themselves are Better Auth's.
import { oauthProviderAuthServerMetadata, verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { readFields, sameOrigin, seeOther } from "../http/request";
import { logger } from "../log";
import { MCP_SCOPES, signedInSession, type Auth } from "./auth";
import { config } from "../config";

const log = logger("oauth");
const cors = { "Access-Control-Allow-Origin": "*" };
// What the metadata names but notefeed doesn't serve: introspection needs a confidential client, which no MCP client is.
const UNSERVED = ["introspection_endpoint", "introspection_endpoint_auth_methods_supported", "introspection_endpoint_auth_signing_alg_values_supported"];

// RFC 8414, at /.well-known/oauth-authorization-server and below it the issuer's path (/api/auth).
export async function accountsAuthServerRoute(auth: Auth, req: Request): Promise<Response> {
  const res = await oauthProviderAuthServerMetadata(auth)(req);
  const body = (await res.json()) as Record<string, unknown>;
  for (const k of UNSERVED) delete body[k];
  return Response.json(body, { status: res.status, headers: cors });
}

// RFC 9728: /mcp, whose tokens Better Auth issues.
export function accountsProtectedResourceRoute(): Response {
  const base = config.publicUrl();
  return Response.json(
    { resource: `${base}/mcp`, authorization_servers: [`${base}/api/auth`], bearer_methods_supported: ["header"], scopes_supported: MCP_SCOPES },
    { headers: cors },
  );
}

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

// POST /api/oauth/authorize with accounts: the page's Allow or Deny, from this instance's own pages, for the account signed in on
// them. Better Auth checks the signed request again and answers with where the browser goes: the client, with a code or access_denied.
export async function consentRoute(auth: Auth, req: Request): Promise<Response> {
  const h = req.headers;
  if (!sameOrigin(h)) return new Response("forbidden", { status: 403 });
  const form = await readFields(req, 16 * 1024);
  const raw = form?.get("oauth_query");
  const query = typeof raw === "string" ? await oauthQuery(auth, new URLSearchParams(raw)) : null;
  if (!query) return new Response("This sign-in has expired. Connect again from your MCP client.", { status: 400 });
  const session = await signedInSession(h);
  if (!session) return seeOther(`/oauth/authorize?${query}&error=auth`);
  const accept = form?.get("accept") === "1";
  const r = await auth.api.oauth2Consent({ body: { accept, oauth_query: query }, headers: h }).catch(() => null);
  if (!r?.url) return new Response("This sign-in has expired. Connect again from your MCP client.", { status: 400 });
  log.info({ via: "account", accept }, accept ? "authorization granted" : "authorization denied"); // never who, never the client's name
  return seeOther(r.url);
}
