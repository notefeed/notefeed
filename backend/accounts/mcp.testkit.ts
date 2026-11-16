// Tests only: an MCP client signed in as an account, through the whole OAuth flow as a client and a browser would run it
// (ADR 0062): register, authorize, the authorize page's Allow, the token. Nothing here is reachable from the app.
import { makeSignature } from "better-auth/crypto";
import { createHash, randomBytes } from "node:crypto";
import { authorizeRoute } from "../oauth/routes";
import { accountsAuth, authRoute } from "./auth";

export const BASE = "http://localhost:3000";
const AUTH = `${BASE}/api/auth`;
export const REDIRECT = "https://client.example/cb";

// `name=value` of a Better Auth session cookie for `userId`.
export async function sessionCookie(userId: string): Promise<string> {
  const ctx = await accountsAuth()!.$context;
  const session = await ctx.internalAdapter.createSession(userId, false, undefined, true);
  return `${ctx.authCookies.sessionToken.name}=${session.token}.${await makeSignature(session.token, ctx.secret)}`;
}

export async function registerClient(name = "Test client"): Promise<string> {
  const res = await authRoute(
    new Request(`${AUTH}/oauth2/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: name, redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" }),
    }),
  );
  if (res.status !== 201) throw new Error(`register: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { client_id: string }).client_id;
}

export type Pending = { clientId: string; verifier: string; page: URL };

// GET /oauth2/authorize with the browser's cookie: where Better Auth sends it (the authorize page, signed).
export async function authorize(clientId: string, cookie?: string, resource = `${BASE}/mcp`): Promise<Pending & { location: string }> {
  const verifier = randomBytes(32).toString("base64url");
  const q = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state: "st",
    resource,
    scope: "openid offline_access",
  });
  const res = await authRoute(new Request(`${AUTH}/oauth2/authorize?${q}`, { headers: cookie ? { cookie } : {} }));
  const location = res.headers.get("location") ?? "";
  return { clientId, verifier, page: new URL(location, BASE), location };
}

// The authorize page's form, posted from the page by the signed-in browser.
export async function answer(pending: Pending, cookie: string, accept: boolean, oauthQuery = pending.page.search.slice(1)): Promise<Response> {
  return authorizeRoute(
    new Request(`${BASE}/api/oauth/authorize`, {
      method: "POST",
      headers: { cookie, origin: BASE, host: "localhost:3000", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ oauth_query: oauthQuery, accept: accept ? "1" : "0" }),
    }),
  );
}

export async function token(pending: Pending, code: string): Promise<{ access_token: string; refresh_token: string }> {
  const res = await authRoute(
    new Request(`${AUTH}/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT,
        client_id: pending.clientId,
        code_verifier: pending.verifier,
        resource: `${BASE}/mcp`,
      }),
    }),
  );
  if (res.status !== 200) throw new Error(`token: ${res.status} ${await res.text()}`);
  return res.json();
}

// An access token for /mcp, as the account `userId`.
export async function mcpToken(userId: string): Promise<string> {
  const cookie = await sessionCookie(userId);
  const pending = await authorize(await registerClient(), cookie);
  const res = await answer(pending, cookie, true);
  const code = new URL(res.headers.get("location")!).searchParams.get("code")!;
  return (await token(pending, code)).access_token;
}
