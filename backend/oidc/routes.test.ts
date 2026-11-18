import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { migrateAccounts, signedInName } from "../accounts/auth";
import { resetFeedsForTests } from "../feeds";
import { resetRateLimitsForTests } from "../limits";
import { logTo } from "../log";
import { BASE, Jar, type MockProvider, providerEnv, signIn, startProvider } from "./mockprovider.testkit";
import { oidcFinishRoute, oidcStartRoute } from "./routes";

const H = { host: "localhost:3000" };

let idp: MockProvider;
let other: MockProvider;
beforeAll(async () => {
  [idp, other] = await Promise.all([startProvider(), startProvider()]);
});
afterAll(async () => {
  await Promise.all([idp.stop(), other.stop()]);
});

let lines: string[];
let restore: () => void;
const stubEnv = (env: Record<string, string>) => Object.entries(env).forEach(([k, v]) => vi.stubEnv(k, v));
beforeEach(async () => {
  vi.stubEnv("NOTEFEED_SECRET", "test-secret-".padEnd(32, "x"));
  vi.stubEnv("NOTEFEED_PASSWORD", "");
  vi.stubEnv("PUBLIC_URL", BASE);
  stubEnv(providerEnv(idp, "ann@x.com"));
  idp.claims = { name: "Ann", email: "ann@x.com", email_verified: true };
  other.claims = { name: "Bea", email: "bea@y.com", email_verified: true };
  resetFeedsForTests();
  resetRateLimitsForTests();
  await migrateAccounts();
  lines = [];
  restore = logTo((l) => void lines.push(l));
});
afterEach(() => {
  vi.unstubAllEnvs();
  restore();
});
const entries = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>);
const warned = () => entries().filter((e) => e.level === "warn" && e.component === "oidc");

const get = (path: string, cookie?: string) => new Request(BASE + path, { headers: { ...H, ...(cookie ? { cookie } : {}) } });
const webStart = (query = "next=/feed") => get(`/api/oidc/start?${query}`);
const nameOf = (jar: Jar) => signedInName(new Headers({ ...H, cookie: jar.header() }));

test("start and finish are 404 while no provider is configured", async () => {
  vi.stubEnv("NOTEFEED_OIDC_ALLOW", "");
  vi.stubEnv("NOTEFEED_PASSWORD", "pw");
  expect((await oidcStartRoute(webStart())).status).toBe(404);
  expect((await oidcFinishRoute(get("/api/oidc/finish?next=/"))).status).toBe(404);
});

describe("web sign-in", () => {
  test("signs in, lands on next, and signedInName gives the name claim", async () => {
    const { location, jar } = await signIn(webStart());
    expect(location).toBe("/feed");
    expect(await nameOf(jar)).toBe("Ann");
    expect(entries().find((e) => e.msg === "sign-in succeeded")).toMatchObject({ component: "oidc", provider: "default" });
    expect(lines.join("\n")).not.toContain("ann@x.com");
  });

  test("without a session signedInName is undefined", async () => {
    expect(await signedInName(new Headers(H))).toBeUndefined();
  });

  test("NOTEFEED_OIDC_SENDER_CLAIM order is honoured", async () => {
    vi.stubEnv("NOTEFEED_OIDC_SENDER_CLAIM", "preferred_username,name");
    idp.claims = { ...idp.claims, preferred_username: "ann.k" };
    const { jar } = await signIn(webStart());
    expect(await nameOf(jar)).toBe("ann.k");
  });

  test("* lets a person in whose id_token has no email", async () => {
    vi.stubEnv("NOTEFEED_OIDC_ALLOW", "*");
    idp.claims = { name: "Cy", email: undefined, email_verified: undefined };
    const { location, jar } = await signIn(webStart());
    expect(location).toBe("/feed");
    expect(await nameOf(jar)).toBe("Cy");
  });

  test("a second sign-in with a changed name changes the signed-in name", async () => {
    await signIn(webStart());
    idp.claims = { ...idp.claims, name: "Ann K." };
    const { jar } = await signIn(webStart());
    expect(await nameOf(jar)).toBe("Ann K.");
  });

  test("an https public URL makes the session cookie Secure", async () => {
    vi.stubEnv("PUBLIC_URL", "https://notes.example");
    const { responses } = await signIn(webStart());
    const session = responses.flatMap((r) => r.headers.getSetCookie()).find((c) => /session_token=/.test(c));
    expect(session).toMatch(/; Secure/i);
  });

  test.each([
    ["an address not on the allow-list", { email: "eve@x.com" }, "person not on the allow-list"],
    ["an unverified email", { email_verified: false }, "address needs a verified email"],
    ["a token without the sender claim", { name: undefined, email: undefined }, "no sender claim in the id_token"],
  ])("refuses %s, says why in the log, never who", async (_, change, reason) => {
    if (reason === "no sender claim in the id_token") vi.stubEnv("NOTEFEED_OIDC_ALLOW", "*");
    idp.claims = { ...idp.claims, ...change };
    const { location, jar } = await signIn(webStart());
    expect(location).toBe("/login?error=sign_in_failed&next=%2Ffeed");
    expect(await nameOf(jar)).toBeUndefined();
    expect(warned().map((e) => e.msg)).toContain(reason);
    expect(lines.join("\n")).not.toMatch(/eve@x\.com|ann@x\.com/);
  });

  test("a provider refusing the token request is logged with its provider and error", async () => {
    idp.failToken();
    const { location } = await signIn(webStart());
    expect(location).toMatch(/^\/login\?error=sign_in_failed/);
    expect(warned().at(-1)).toMatchObject({ provider: "default" });
  });

  test("an unknown provider goes back to the login page without contacting any provider", async () => {
    const res = await oidcStartRoute(webStart("provider=nope&next=/feed"));
    expect(res.headers.get("location")).toBe("/login?error=sign_in_failed&next=%2Ffeed");
    expect(warned().map((e) => e.msg)).toEqual(["unknown provider"]);
  });

  test("an issuer that is plain http off loopback is refused at the start", async () => {
    vi.stubEnv("NOTEFEED_OIDC_ISSUER", "http://idp.example");
    const res = await oidcStartRoute(webStart());
    expect(res.headers.get("location")).toMatch(/^\/login\?error=sign_in_failed/);
    expect(warned().map((e) => e.msg)).toEqual(["issuer is not an https URL"]);
  });

  test("failed sign-ins count toward the failed-attempt limit, and over it the wait is shown", async () => {
    vi.stubEnv("NOTEFEED_RATE_LIMIT", "2");
    idp.claims = { ...idp.claims, email: "eve@x.com" };
    for (let i = 0; i < 2; i++) await signIn(webStart());
    const { location } = await signIn(webStart());
    expect(location).toMatch(/error=too_many_attempts&retry=\d+/);
  });

  test("finish without a session is a failed sign-in", async () => {
    const res = await oidcFinishRoute(get("/api/oidc/finish?next=/feed"));
    expect(res.headers.get("location")).toMatch(/^\/login\?error=sign_in_failed/);
  });
});

describe("MCP sign-in", () => {
  // A provider signs the person in like any other sign-in; next brings them back to the client's authorize page (ADR 0062).
  test("goes back to the authorize page, with Better Auth's signed request, through next", async () => {
    const next = "/oauth/authorize?client_id=c&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&sig=abc%3D";
    const { location } = await signIn(webStart(`next=${encodeURIComponent(next)}`));
    expect(location).toBe(next);
  });

  test("finish with forged authorize fields issues no code", async () => {
    const { jar } = await signIn(webStart());
    const res = await oidcFinishRoute(get(`/api/oidc/finish?authorize=forged.x`, jar.header()));
    expect(res.headers.get("location")).toMatch(/^\/login\?error=sign_in_failed/);
  });
});

describe("several providers", () => {
  beforeEach(async () => {
    stubEnv(providerEnv(other, "@y.com", "WORK"));
    await migrateAccounts();
  });

  test("each provider signs in its own people with its own allow-list", async () => {
    const work = await signIn(webStart("provider=work&next=/"));
    expect(await nameOf(work.jar)).toBe("Bea");
    other.claims = { ...other.claims, email: "ann@x.com" };
    const refused = await signIn(webStart("provider=work&next=/"));
    expect(refused.location).toMatch(/^\/login\?error=sign_in_failed/);
  });

  test("with several providers, naming none is refused", async () => {
    const res = await oidcStartRoute(webStart("next=/"));
    expect(res.headers.get("location")).toMatch(/^\/login\?error=sign_in_failed/);
  });
});

describe("what sign-in keeps", () => {
  test("the client secret goes in the token request's body (client_secret_post)", async () => {
    idp.tokenRequests.length = 0;
    await signIn(webStart());
    expect(idp.tokenRequests.at(-1)).toMatchObject({ body: { client_id: "notefeed", client_secret: "secret" }, authorization: undefined });
  });

  test("changing NOTEFEED_PASSWORD signs everyone out", async () => {
    const { jar } = await signIn(webStart());
    vi.stubEnv("NOTEFEED_PASSWORD", "a-new-password");
    expect(await nameOf(jar)).toBeUndefined();
  });

  test("none of the provider's tokens is stored, on the first sign-in or a later one", async () => {
    await signIn(webStart());
    await signIn(webStart());
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(`${process.env.DATA_DIR}/accounts.sqlite`, { readonly: true });
    const rows = db.prepare("select accessToken, refreshToken, idToken from account").all();
    db.close();
    expect(rows).toEqual([{ accessToken: null, refreshToken: null, idToken: null }]);
  });
});

describe("final review", () => {
  test("finish refuses a valid flight that another browser started (a link cut out of someone else's sign-in)", async () => {
    const victim = await signIn(webStart());
    const { sign: signFlight } = await import("../signed");
    const f = signFlight("oidc", { provider: "default", nonce: "the-attackers-own", next: "/elsewhere" });
    const res = await oidcFinishRoute(get(`/api/oidc/finish?f=${encodeURIComponent(f)}`, victim.jar.header()));
    expect(res.headers.get("location")).toMatch(/^\/login\?error=sign_in_failed/);
    expect(warned().map((e) => e.msg)).toContain("state mismatch or missing sign-in cookie");
  });

  test("the signed-in name is cleaned and capped before it becomes a sender", async () => {
    vi.stubEnv("NOTEFEED_OIDC_ALLOW", "*");
    idp.claims = { name: `Ann‮${"x".repeat(150)}`, email: "ann@x.com", email_verified: true };
    const { jar } = await signIn(webStart());
    const name = await nameOf(jar);
    expect(name).not.toMatch(/‮/);
    expect([...name!].length).toBeLessThanOrEqual(100);
  });

  test("a session keeps neither the client's address nor its user agent", async () => {
    const start = new Request(`${BASE}/api/oidc/start?next=/`, { headers: { ...H, "user-agent": "Secret/1.0", "x-forwarded-for": "203.0.113.9" } });
    vi.stubEnv("NOTEFEED_TRUST_PROXY", "1");
    await signIn(start);
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(`${process.env.DATA_DIR}/accounts.sqlite`, { readonly: true });
    const rows = db.prepare("select ipAddress, userAgent from session").all();
    db.close();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r).toEqual({ ipAddress: null, userAgent: null });
  });

  test.each([
    "/api/auth/update-user",
    "/api/auth/sign-in/social",
    "/api/auth/link-social",
    "/api/auth/unlink-account",
    "/api/auth/list-accounts",
    "/api/auth/account-info",
    "/api/auth/get-access-token",
    "/api/auth/refresh-token",
    "/api/auth/delete-user",
    "/api/auth/change-email",
    "/api/auth/list-sessions",
    "/api/auth/revoke-sessions",
  ])("Better Auth's %s is closed: notefeed's sign-in never uses it", async (path) => {
    const { jar } = await signIn(webStart());
    const { authRoute } = await import("../accounts/auth");
    const res = await authRoute(
      new Request(BASE + path, {
        method: "POST",
        headers: { ...H, origin: BASE, cookie: jar.header(), "content-type": "application/json" },
        body: JSON.stringify({ name: "Boss", provider: "default", idToken: { token: "x" } }),
      }),
    );
    expect(res.status).toBe(404);
    expect(await nameOf(jar)).toBe("Ann");
  });

  test("the same e-mail at a second provider is not linked to the first one's person", async () => {
    stubEnv(providerEnv(other, "*", "WORK"));
    await migrateAccounts();
    await signIn(webStart("provider=default&next=/"));
    other.claims = { name: "Not Ann", email: "ann@x.com", email_verified: true };
    const second = await signIn(webStart("provider=work&next=/"));
    expect(second.location).toMatch(/^\/login\?error=sign_in_failed/);
  });
});
