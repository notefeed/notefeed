import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SESSION_COOKIE } from "@/backend";
import { signedInCookie, stubSignInOn } from "@/backend/accounts/signin.testkit";
import { login } from "@/backend/auth";
import { config, proxy } from "./proxy";

beforeEach(() => {
  delete process.env.NOTEFEED_PASSWORD;
});
afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.PUBLIC_URL;
  delete process.env.NOTEFEED_TRUST_PROXY;
});

const req = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest(`http://localhost:3000${path}`, { method: init.method, headers: { host: "localhost:3000", ...init.headers } });
const rewrite = (res: Response) => res.headers.get("x-middleware-rewrite");
const isNext = (res: Response) => res.headers.get("x-middleware-next") === "1";
// Where a page went: the path of the rewrite, or null when there is none.
const rewrittenTo = (res: Response) => (rewrite(res) ? new URL(rewrite(res)!).pathname : null);
// Through the proxy: as it was (a route handler, a static file) or rewritten to its language (a page, #352).
const passes = (res: Response) => isNext(res) || (rewrittenTo(res)?.startsWith("/en") ?? false);

test("POST /<feed> is rewritten to the notes route", async () => {
  expect(rewrite(await proxy(req("/backups", { method: "POST" })))).toBe("http://localhost:3000/api/v1/feeds/backups/notes");
});

test("POST /<feed>/: one trailing slash is stripped (skipTrailingSlashRedirect lets it reach the proxy)", async () => {
  expect(rewrite(await proxy(req("/backups/", { method: "POST" })))).toBe("http://localhost:3000/api/v1/feeds/backups/notes");
});

test("other trailing slashes still get Next's usual 308 to the path without it", async () => {
  for (const [p, want] of [
    ["/backups/", "/backups"],
    ["/backups/x/?a=1", "/backups/x?a=1"],
    ["/login/", "/login"],
  ]) {
    const res = await proxy(req(p));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(`http://localhost:3000${want}`);
  }
  expect((await proxy(req("/backups/x/", { method: "POST" }))).status).toBe(308);
});

// Method and path decide, never headers: a browser form, fetch(), curl -F and a client package all
// reach the same handler.
test.each<Record<string, string>>([
  {},
  { "next-action": "abc" },
  { "content-type": "multipart/form-data; boundary=x", accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
  { "content-type": "multipart/form-data; boundary=x", accept: "*/*" },
  { "content-type": "application/json", accept: "application/json" },
])("POST /<feed> with headers %j is rewritten to the notes route", async (headers) => {
  expect(rewrite(await proxy(req("/backups", { method: "POST", headers })))).toBe("http://localhost:3000/api/v1/feeds/backups/notes");
});

test("POST /login goes to the login route, whatever the headers", async () => {
  for (const headers of [{}, { "next-action": "abc" }, { accept: "text/html" }] as Record<string, string>[])
    expect(rewrite(await proxy(req("/login", { method: "POST", headers })))).toBe("http://localhost:3000/api/login");
  expect(rewrite(await proxy(req("/login/", { method: "POST" })))).toBe("http://localhost:3000/api/login");
});

test("POST / (e.g. an empty feed variable) is a JSON 404, not the start page", async () => {
  for (const p of ["/", "/%2e%2e"]) {
    const res = await proxy(req(p, { method: "POST" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no feed in URL" });
  }
  process.env.NOTEFEED_PASSWORD = "pw";
  expect((await proxy(req("/", { method: "POST" }))).status).toBe(404);
});

test.each(["/a/b", "/backups//x"])("POST %s (not one segment) is not rewritten to the notes route, only to its language", async (p) => {
  expect(rewrittenTo(await proxy(req(p, { method: "POST" })))).toBe(`/en${p}`);
});

test("GET /<feed> is rewritten to its language only", async () => {
  expect(rewrittenTo(await proxy(req("/backups")))).toBe("/en/backups");
});

// #352: every page is rewritten to /<lang>/…, so no URL carries the language; route handlers and static files are left alone.
test.each([
  ["/", "/en"],
  ["/backups", "/en/backups"],
  ["/backups/settings", "/en/backups/settings"],
  ["/backups/Qw8nR2dLm5XaTc1VbJ7kUe", "/en/backups/Qw8nR2dLm5XaTc1VbJ7kUe"],
  ["/r/q2Zc9kD0bTnVx4LmAe7sWp", "/en/r/q2Zc9kD0bTnVx4LmAe7sWp"],
  ["/r/q2Zc9kD0bTnVx4LmAe7sWp/Qw8nR2dLm5XaTc1VbJ7kUe", "/en/r/q2Zc9kD0bTnVx4LmAe7sWp/Qw8nR2dLm5XaTc1VbJ7kUe"],
  ["/login?next=/x", "/en/login"],
  ["/oauth/authorize", "/en/oauth/authorize"],
  ["/en", "/en/en"], // a feed called en is a feed, never the language
])("the page %s is rendered as %s", async (p, to) => {
  expect(rewrittenTo(await proxy(req(p)))).toBe(to);
});

test.each([
  "/api/v1/feeds/x/notes",
  "/mcp",
  "/metrics",
  "/health",
  "/logout",
  "/oauth/token",
  "/oauth/register",
  "/.well-known/oauth-authorization-server",
  "/r/q2Zc9kD0bTnVx4LmAe7sWp/feed.xml",
  "/r/q2Zc9kD0bTnVx4LmAe7sWp/atom.xml",
  "/r/q2Zc9kD0bTnVx4LmAe7sWp/files/a.png",
  "/r/q2Zc9kD0bTnVx4LmAe7sWp/skill.md",
  "/icon.svg",
  "/manifest.webmanifest",
  "/sw.js",
  "/shortcuts/notefeed.shortcut",
])("%s is no page: left as it is", async (p) => {
  const res = await proxy(req(p));
  expect(rewrite(res)).toBeNull();
  expect(isNext(res)).toBe(true);
});

test("the language: the nf_lang cookie if the UI speaks it, else Accept-Language, else English", async () => {
  expect(rewrittenTo(await proxy(req("/", { headers: { "accept-language": "fr, en;q=0.5" } })))).toBe("/en");
  expect(rewrittenTo(await proxy(req("/", { headers: { cookie: "nf_lang=xx", "accept-language": "xx" } })))).toBe("/en");
});

test("encoded traversal: %2e%2e normalizes to / (not rewritten); a%2Fb stays encoded for the handler to reject", async () => {
  expect(rewrite(await proxy(req("/%2e%2e", { method: "POST" })))).toBeNull();
  const target = rewrite(await proxy(req("/a%2Fb", { method: "POST" })))!;
  expect(target).toBe("http://localhost:3000/api/v1/feeds/a%2Fb/notes");
  // Next decodes the [feed] param; the handler rejects "a/b" (see backend/http/notes.test.ts).
  expect(decodeURIComponent(new URL(target).pathname.split("/")[4])).toBe("a/b");
});

test("locked: pages without a session redirect to the absolute public /login", async () => {
  process.env.NOTEFEED_PASSWORD = "pw";
  const res = await proxy(req("/backups"));
  expect(res.status).toBe(307);
  expect(res.headers.get("location")).toBe("http://localhost:3000/login?next=%2Fbackups");
});

test("locked: the redirect keeps the query in next, and / needs none", async () => {
  process.env.NOTEFEED_PASSWORD = "pw";
  expect((await proxy(req("/backups/x?a=1"))).headers.get("location")).toBe("http://localhost:3000/login?next=%2Fbackups%2Fx%3Fa%3D1");
  expect((await proxy(req("/"))).headers.get("location")).toBe("http://localhost:3000/login");
});

test("locked: what was shared to the start page survives the sign-in", async () => {
  process.env.NOTEFEED_PASSWORD = "pw";
  expect((await proxy(req("/?share_text=hi&shared=1"))).headers.get("location")).toBe("http://localhost:3000/login?next=%2F%3Fshare_text%3Dhi%26shared%3D1");
});

test("locked: a valid session cookie passes", async () => {
  process.env.NOTEFEED_PASSWORD = "pw";
  expect(passes(await proxy(req("/backups", { headers: { cookie: `${SESSION_COOKIE}=${login("pw", "test")}` } })))).toBe(true);
});

test("sign-in on: a Better Auth session passes the lock; a forged one, or one when sign-in is off, does not", async () => {
  stubSignInOn();
  const cookie = await signedInCookie();
  expect(passes(await proxy(req("/backups", { headers: { cookie } })))).toBe(true);
  expect(passes(await proxy(req("/backups", { headers: { cookie: cookie.slice(0, -4) + "AAAA" } })))).toBe(false);
  expect(passes(await proxy(req("/backups")))).toBe(false); // to /login
  vi.stubEnv("NOTEFEED_OIDC_ALLOW", "");
  vi.stubEnv("NOTEFEED_PASSWORD", "pw");
  expect(passes(await proxy(req("/backups", { headers: { cookie } })))).toBe(false);
});

test("locked: POST /login is rewritten without a session (that's how you get one)", async () => {
  process.env.NOTEFEED_PASSWORD = "pw";
  expect(rewrite(await proxy(req("/login", { method: "POST" })))).toBe("http://localhost:3000/api/login");
});

test.each(["/r/x/feed.xml", "/login", "/_next/static/x.js", "/api/v1/feeds/backups/notes", "/api/login"])("locked: %s passes", async (p) => {
  process.env.NOTEFEED_PASSWORD = "pw";
  expect(passes(await proxy(req(p)))).toBe(true);
});

test("locked: the service worker passes, so a browser whose sign-in ran out still gets its update", async () => {
  process.env.NOTEFEED_PASSWORD = "pw";
  expect(passes(await proxy(req("/sw.js")))).toBe(true);
});

test.each([
  "/mcp",
  "/metrics",
  "/health",
  "/oauth/authorize?x=1",
  "/oauth/token",
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-protected-resource/mcp",
])("locked: %s is not sent to /login", async (p) => {
  process.env.NOTEFEED_PASSWORD = "pw";
  expect(passes(await proxy(req(p)))).toBe(true);
});

const OIDC = {
  NOTEFEED_SECRET: "a".repeat(40),
  NOTEFEED_OIDC_ISSUER: "https://idp.example",
  NOTEFEED_OIDC_CLIENT_ID: "id",
  NOTEFEED_OIDC_CLIENT_SECRET: "s",
  NOTEFEED_OIDC_ALLOW: "*",
};

test.each(["password", "identity-only"])("locked (%s): /privacy and /imprint pass without a session, other pages still redirect", async (mode) => {
  if (mode === "password") process.env.NOTEFEED_PASSWORD = "pw";
  else for (const [k, v] of Object.entries(OIDC)) vi.stubEnv(k, v);
  for (const p of ["/privacy", "/imprint"]) {
    const res = await proxy(req(p));
    expect(rewrittenTo(res)).toBe(`/en${p}`);
    expect(res.status).toBe(200);
  }
  expect((await proxy(req("/privacy/"))).status).toBe(308); // slash strip still runs before the lock check
  expect((await proxy(req("/"))).headers.get("location")).toBe("http://localhost:3000/login");
  expect((await proxy(req("/privacy/x"))).status).toBe(307);
});

test("POST /mcp is not rewritten and passes (open instance)", async () => {
  const res = await proxy(req("/mcp", { method: "POST" }));
  expect(rewrite(res)).toBeNull();
  expect(isNext(res)).toBe(true);
});

test("POST /mcp is not rewritten and passes (locked instance)", async () => {
  process.env.NOTEFEED_PASSWORD = "pw";
  const res = await proxy(req("/mcp", { method: "POST" }));
  expect(rewrite(res)).toBeNull();
  expect(isNext(res)).toBe(true);
});

test.each(["/metrics", "/health"])("POST %s is not rewritten to a feed's notes", async (p) => {
  const res = await proxy(req(p, { method: "POST" }));
  expect(rewrite(res)).toBeNull();
  expect(isNext(res)).toBe(true);
});

test("locked: POST /<feed> is still rewritten (the handler checks the bearer)", async () => {
  process.env.NOTEFEED_PASSWORD = "pw";
  expect(rewrite(await proxy(req("/backups", { method: "POST" })))).toBe("http://localhost:3000/api/v1/feeds/backups/notes");
});

test("matcher skips /_next/ and the favicon; /r/ passes through, for its pages' language", async () => {
  const re = new RegExp(`^${config.matcher}$`);
  for (const p of ["/_next/static/x.js", "/favicon.ico"]) expect(re.test(p)).toBe(false);
  for (const p of ["/", "/backups", "/login", "/rabbit", "/r/x", "/r/x/feed.xml"]) expect(re.test(p)).toBe(true);
});

// Next's proxy runtime rejects a relative Location ("Invalid URL" → 500), so it must be absolute
// and point at the public address, not the internal one.
test("redirects to the public /login behind a reverse proxy", async () => {
  process.env.NOTEFEED_PASSWORD = "pw";
  process.env.NOTEFEED_TRUST_PROXY = "1";
  const res = await proxy(
    new NextRequest("http://internal:3000/n/x", {
      headers: { "x-forwarded-proto": "https", "x-forwarded-host": "notes.example" },
    }),
  );
  expect(res.status).toBe(307);
  expect(res.headers.get("location")).toBe("https://notes.example/login?next=%2Fn%2Fx");
});

test("PUBLIC_URL wins for the redirect", async () => {
  process.env.NOTEFEED_PASSWORD = "pw";
  process.env.PUBLIC_URL = "https://notefeed.example.com";
  const res = await proxy(new NextRequest("http://internal:3000/", { headers: { host: "internal:3000" } }));
  expect(res.headers.get("location")).toBe("https://notefeed.example.com/login");
});

test("POST /logout (a real POST route) is not rewritten", async () => {
  const res = await proxy(req("/logout", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" } }));
  expect(rewrite(res)).toBeNull();
  expect(isNext(res)).toBe(true);
});

test.each(["api", "n", "r"])("POST /%s (reserved) goes to the handler, which answers 400", async (name) => {
  expect(rewrite(await proxy(req(`/${name}`, { method: "POST" })))).toBe(`http://localhost:3000/api/v1/feeds/${name}/notes`);
});
