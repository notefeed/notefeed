// MCP sign-in through Better Auth's OAuth server (ADR 0062), with accounts and on an instance the password locks: discovery, the
// authorize page's answer, the token on /mcp, and what /mcp refuses.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { resetRateLimitsForTests } from "../limits";
import { mcpRoute } from "../mcp";
import { accountsAuth, authRoute, migrateAccounts } from "./auth";
import { authorizeRoute, authServerRoute, metadataPreflight, oauthClient, oauthQuery, protectedResourceRoute } from "./mcpoauth";
import { answer, authorize, BASE, mcpToken, registerClient, REDIRECT, sessionCookie, token } from "./mcp.testkit";
import { createAccount } from "./numbers";

beforeEach(async () => {
  vi.stubEnv("NOTEFEED_SECRET", "test-secret-".padEnd(32, "x"));
  vi.stubEnv("NOTEFEED_PASSWORD", "");
  vi.stubEnv("PUBLIC_URL", BASE);
  vi.stubEnv("NOTEFEED_ACCOUNTS", "open");
  await migrateAccounts();
});
afterEach(() => vi.unstubAllEnvs());

const V = "2026-07-28";
function mcp(authorization?: string): Request {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "list_feeds",
      arguments: {},
      _meta: {
        "io.modelcontextprotocol/clientInfo": { name: "t", version: "0" },
        "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/protocolVersion": V,
      },
    },
  };
  const headers: Record<string, string> = {
    host: "localhost:3000",
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": V,
    "mcp-method": "tools/call",
    "mcp-name": "list_feeds",
    ...(authorization ? { authorization } : {}),
  };
  return new Request(`${BASE}/mcp`, { method: "POST", headers, body: JSON.stringify(body) });
}

test("discovery names Better Auth's server, at the root and below the issuer's path, and /mcp as the resource", async () => {
  const meta = await (await authServerRoute(new Request(`${BASE}/.well-known/oauth-authorization-server`))).json();
  expect(meta).toMatchObject({
    issuer: `${BASE}/api/auth`,
    authorization_endpoint: `${BASE}/api/auth/oauth2/authorize`,
    token_endpoint: `${BASE}/api/auth/oauth2/token`,
    registration_endpoint: `${BASE}/api/auth/oauth2/register`,
    code_challenge_methods_supported: ["S256"],
  });
  expect(meta).not.toHaveProperty("introspection_endpoint");
  const pr = await protectedResourceRoute().json();
  expect(pr).toEqual({
    resource: `${BASE}/mcp`,
    authorization_servers: [`${BASE}/api/auth`],
    bearer_methods_supported: ["header"],
    scopes_supported: ["openid", "offline_access"],
  });
});

test("an open instance without accounts has no OAuth: discovery, the page's answer and the preflight are 404", async () => {
  vi.stubEnv("NOTEFEED_ACCOUNTS", "off");
  expect((await authServerRoute(new Request(`${BASE}/.well-known/oauth-authorization-server`))).status).toBe(404);
  expect(protectedResourceRoute().status).toBe(404);
  expect(metadataPreflight().status).toBe(404);
});

test("signed out, authorize sends the browser to the authorize page with the request signed", async () => {
  const { page } = await authorize(await registerClient());
  expect(page.pathname).toBe("/oauth/authorize");
  expect(page.searchParams.get("sig")).toBeTruthy();
  expect(page.searchParams.get("redirect_uri")).toBe(REDIRECT);
  // What the page shows, before anyone has signed in.
  const auth = accountsAuth()!;
  const query = await oauthQuery(auth, page.searchParams);
  expect(query).toBeTruthy();
  expect(await oauthClient(auth, query!)).toEqual({ name: "Test client", redirectHost: "client.example" });
  expect(await oauthQuery(auth, new URLSearchParams(page.search.replace("state=st", "state=x")))).toBeNull();
});

test("Allow sends a code; the token acts as the account on /mcp; once allowed, the next authorize skips the page", async () => {
  const { userId } = await createAccount();
  const cookie = await sessionCookie(userId);
  const clientId = await registerClient();
  const pending = await authorize(clientId, cookie);
  const res = await answer(pending, cookie, true);
  const back = new URL(res.headers.get("location")!);
  expect(back.origin + back.pathname).toBe(REDIRECT);
  expect(back.searchParams.get("state")).toBe("st");
  const t = await token(pending, back.searchParams.get("code")!);
  const claims = JSON.parse(Buffer.from(t.access_token.split(".")[1], "base64url").toString());
  expect(claims).toMatchObject({ sub: userId, iss: `${BASE}/api/auth` });
  expect(claims.aud).toContain(`${BASE}/mcp`);
  const listed = await (await mcpRoute(mcp(`Bearer ${t.access_token}`))).json();
  expect(listed.result.structuredContent.feeds).toEqual([]);
  const again = await authorize(clientId, cookie);
  expect(again.location.startsWith(`${REDIRECT}?code=`)).toBe(true);
});

test("Deny sends access_denied to the client", async () => {
  const { userId } = await createAccount();
  const cookie = await sessionCookie(userId);
  const pending = await authorize(await registerClient(), cookie);
  const back = new URL((await answer(pending, cookie, false)).headers.get("location")!);
  expect(back.searchParams.get("error")).toBe("access_denied");
});

test("the answer needs the signed request unchanged, a session, and this instance's own page", async () => {
  const { userId } = await createAccount();
  const cookie = await sessionCookie(userId);
  const pending = await authorize(await registerClient(), cookie);
  const changed = pending.page.search.slice(1).replace(`state=st`, `state=other`);
  expect((await answer(pending, cookie, true, changed)).headers.get("location")).toBe("/oauth/authorize?error=expired");
  const signedOut = await answer(pending, "", true);
  expect(signedOut.headers.get("location")).toMatch(/^\/oauth\/authorize\?.*&error=auth$/);
  const cross = await authRoute(new Request(`${BASE}/api/auth/oauth2/consent`, { method: "POST", headers: { cookie } }));
  expect(cross.status).toBe(404); // consent is the page's, on the server
});

test("/mcp refuses a bad token, and one whose account is gone; an open instance asks a client without one to sign in for an account tool", async () => {
  const { userId } = await createAccount();
  const t = await mcpToken(userId);
  const bad = await mcpRoute(mcp(`Bearer ${t.slice(0, -4)}AAAA`));
  expect(bad.status).toBe(401);
  expect(bad.headers.get("www-authenticate")).toMatch(/resource_metadata=/);
  await (await accountsAuth()!.$context).internalAdapter.deleteUser(userId);
  expect((await mcpRoute(mcp(`Bearer ${t}`))).status).toBe(401);
  const anonymous = await mcpRoute(mcp()); // list_feeds needs an account: the client is asked to sign in
  expect(anonymous.status).toBe(401);
  expect(anonymous.headers.get("www-authenticate")).toMatch(/resource_metadata=/);
});

test("an instance that accounts lock wants a token on /mcp", async () => {
  vi.stubEnv("NOTEFEED_ACCOUNTS", "closed");
  const res = await mcpRoute(mcp());
  expect(res.status).toBe(401);
  expect(res.headers.get("www-authenticate")).toMatch(/^Bearer /);
});

test("the token, register and keys routes answer any origin; the rest of Better Auth stays closed", async () => {
  const pre = await authRoute(new Request(`${BASE}/api/auth/oauth2/token`, { method: "OPTIONS" }));
  expect(pre.status).toBe(204);
  expect(pre.headers.get("access-control-allow-origin")).toBe("*");
  const jwks = await authRoute(new Request(`${BASE}/api/auth/jwks`));
  expect(jwks.status).toBe(200);
  expect(jwks.headers.get("access-control-allow-origin")).toBe("*");
  expect((await authRoute(new Request(`${BASE}/api/auth/token`))).status).toBe(404);
  expect((await authRoute(new Request(`${BASE}/api/auth/oauth2/introspect`, { method: "POST" }))).status).toBe(404);
});

test("a native client's loopback redirect registers, also without application_type (Cursor, older Claude Code)", async () => {
  const res = await authRoute(
    new Request(`${BASE}/api/auth/oauth2/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "cli", redirect_uris: ["http://127.0.0.1:33418/callback"], token_endpoint_auth_method: "none" }),
    }),
  );
  expect(res.status).toBe(201);
});

describe("an instance the password locks", () => {
  beforeEach(async () => {
    vi.stubEnv("NOTEFEED_ACCOUNTS", "");
    vi.stubEnv("NOTEFEED_PASSWORD", "pw");
    resetRateLimitsForTests();
    await migrateAccounts();
  });
  const login = (query: string, password: string) =>
    authorizeRoute(
      new Request(`${BASE}/api/oauth/authorize`, {
        method: "POST",
        headers: { origin: BASE, host: "localhost:3000", "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ oauth_query: query, password }),
      }),
    );
  async function connect() {
    const pending = await authorize(await registerClient());
    expect(pending.page.pathname).toBe("/oauth/authorize"); // no session ever: always the page
    const res = await login(pending.page.search.slice(1), "pw");
    const back = new URL(res.headers.get("location")!);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    return token(pending, back.searchParams.get("code")!);
  }

  test("discovery is Better Auth's; none of its sign-in or account routes is served", async () => {
    expect((await (await authServerRoute(new Request(`${BASE}/.well-known/oauth-authorization-server`))).json()).issuer).toBe(`${BASE}/api/auth`);
    expect(protectedResourceRoute().status).toBe(200);
    for (const path of ["/api/auth/passkey/generate-authenticate-options", "/api/auth/callback/default", "/api/auth/oauth2/consent"])
      expect((await authRoute(new Request(`${BASE}${path}`, { method: "POST" }))).status, path).toBe(404);
  });

  test("the password on the authorize page gives a code; the token works on /mcp, and so does the refresh", async () => {
    const t = await connect();
    expect((await mcpRoute(mcp(`Bearer ${t.access_token}`))).status).toBe(200);
    const refreshed = await authRoute(
      new Request(`${BASE}/api/auth/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: t.refresh_token,
          client_id: JSON.parse(Buffer.from(t.access_token.split(".")[1], "base64url").toString()).azp,
        }),
      }),
    );
    expect(refreshed.status).toBe(200);
    expect((await mcpRoute(mcp(`Bearer ${(await refreshed.json()).access_token}`))).status).toBe(200);
  });

  test("a wrong password goes back to the page with its error and counts as a failed attempt", async () => {
    vi.stubEnv("NOTEFEED_RATE_LIMIT", "1");
    const pending = await authorize(await registerClient());
    const query = pending.page.search.slice(1);
    expect((await login(query, "nope")).headers.get("location")).toBe(`/oauth/authorize?${query}&error=auth`);
    expect((await login(query, "pw")).headers.get("location")).toMatch(/&error=too_many_attempts&retry=\d+$/);
  });

  test("a changed password ends every client: its tokens and its refresh are refused", async () => {
    const t = await connect();
    vi.stubEnv("NOTEFEED_PASSWORD", "new");
    await migrateAccounts(); // start-up
    expect((await mcpRoute(mcp(`Bearer ${t.access_token}`))).status).toBe(401);
    const refreshed = await authRoute(
      new Request(`${BASE}/api/auth/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: t.refresh_token,
          client_id: JSON.parse(Buffer.from(t.access_token.split(".")[1], "base64url").toString()).azp,
        }),
      }),
    );
    expect(refreshed.status).not.toBe(200);
  });

  test("/mcp still takes the password as a bearer; without anything it points at the OAuth metadata", async () => {
    expect((await mcpRoute(mcp("Bearer pw"))).status).toBe(200);
    const res = await mcpRoute(mcp());
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/resource_metadata=/);
  });

  test("a password that looks like a JWT (two dots) still works as the bearer", async () => {
    vi.stubEnv("NOTEFEED_PASSWORD", "my.secret.pw");
    await migrateAccounts();
    expect((await mcpRoute(mcp("Bearer my.secret.pw"))).status).toBe(200);
  });

  test("without PUBLIC_URL there is no OAuth, only the password as a bearer", async () => {
    vi.stubEnv("PUBLIC_URL", "");
    expect(protectedResourceRoute().status).toBe(404);
    expect((await mcpRoute(mcp())).headers.get("www-authenticate")).toBe('Bearer realm="notefeed"');
  });
});

test("signing keys sealed with an earlier secret are dropped at start-up, and tokens are made again", async () => {
  const { resetFeedsForTests } = await import("../feeds");
  const { userId } = await createAccount();
  await mcpToken(userId);
  vi.stubEnv("NOTEFEED_SECRET", "another-secret-".padEnd(32, "y"));
  resetFeedsForTests(); // the secret is read once per process
  await migrateAccounts(); // start-up
  const again = await createAccount();
  expect(await mcpToken(again.userId)).toMatch(/^ey/);
});
