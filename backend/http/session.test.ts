import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AuthError } from "../errors";
import { SESSION_COOKIE, sessionOk } from "../auth";
import { signedInCookie, stubSignInOn } from "../accounts/signin.testkit";
import { resetFeedsForTests } from "../feeds";
import { resetRateLimitsForTests } from "../limits";
import { logsOf } from "../log";
import { sign } from "../oauth/tokens";
import { authorize, sender } from "./request";
import { loginRoute, logoutRoute } from "./session";

beforeEach(() => {
  process.env.NOTEFEED_PASSWORD = "pw";
  resetRateLimitsForTests();
});
afterEach(() => {
  delete process.env.NOTEFEED_RATE_LIMIT;
  delete process.env.PUBLIC_URL;
});

// What the login page's plain form sends.
const login = (fields: Record<string, string>) =>
  loginRoute(
    new Request("http://localhost:3000/login", {
      method: "POST",
      headers: { host: "localhost:3000", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields),
    }),
  );
const pw = (v: string | undefined) => new Headers(v === undefined ? {} : { cookie: `${SESSION_COOKIE}=${v}` });
const sessionFrom = (res: Response) => /nf_session=([^;]*)/.exec(res.headers.get("set-cookie") ?? "")?.[1];

test("the right password sets the session cookie and returns to next", async () => {
  const res = await login({ password: "pw", next: "/backups?x=1" });
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("/backups?x=1");
  expect(await sessionOk(pw(sessionFrom(res)))).toBe(true);
  expect(res.headers.get("set-cookie")).toMatch(/; Path=\/; Max-Age=31536000; HttpOnly; SameSite=Lax$/);
});

test("the cookie is Secure when the public URL is https", async () => {
  process.env.PUBLIC_URL = "https://notes.example";
  expect((await login({ password: "pw" })).headers.get("set-cookie")).toMatch(/; Secure$/);
});

test.each([undefined, "//evil.example", "https://evil.example", "/\\evil.example"])("next=%j lands on /", async (next) => {
  const res = await login(next === undefined ? { password: "pw" } : { password: "pw", next });
  expect(res.headers.get("location")).toBe("/");
});

test("a wrong password goes back to the login page with the error, keeping next; no cookie", async () => {
  const res = await login({ password: "nope", next: "/backups" });
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("/login?error=auth&next=%2Fbackups");
  expect(res.headers.get("set-cookie")).toBeNull();
});

test("too many wrong passwords: the wait, even for the right one", async () => {
  process.env.NOTEFEED_RATE_LIMIT = "2";
  for (let i = 0; i < 2; i++) await login({ password: "nope" });
  expect((await login({ password: "pw" })).headers.get("location")).toMatch(/^\/login\?error=too_many_attempts&retry=\d+&next=%2F$/);
});

test("a login that worked is an info line without password or address", async () => {
  expect(await logsOf(() => login({ password: "pw" }))).toEqual([{ level: "info", component: "auth", msg: "password login succeeded", page: "login" }]);
});

test("a wrong password logs a warning without password or address; the too-many-attempts refusal is only a debug line", async () => {
  process.env.NOTEFEED_RATE_LIMIT = "1";
  process.env.NOTEFEED_TRUST_PROXY = "1";
  const logs = await logsOf(async () => {
    await login({ password: "nope-secret" });
    await login({ password: "pw" });
  });
  delete process.env.NOTEFEED_TRUST_PROXY;
  expect(logs).toEqual([
    { level: "warn", component: "auth", msg: "password login failed", page: "login" },
    { level: "debug", component: "limits", msg: "rate limit reached", kind: "password" },
  ]);
  expect(JSON.stringify(logs)).not.toMatch(/nope-secret|127\.0\.0\.1|direct/);
});

test("a wrong password bearer is a debug line", async () => {
  const h = new Headers({ host: "localhost:3000", authorization: "Bearer nope-secret" });
  expect(await logsOf(() => expect(authorize(h, "ip")).rejects.toThrow(AuthError))).toEqual([
    { level: "debug", component: "auth", msg: "password bearer refused" },
  ]);
  expect(await logsOf(() => expect(authorize(h, "ip")).rejects.toThrow(AuthError), "info")).toEqual([]);
});

test("a long share carried in next still logs in and comes back", async () => {
  const next = `/?share_text=${encodeURIComponent("Grüße aus dem Artikel. ".repeat(300))}&shared=1`;
  const res = await login({ password: "pw", next });
  expect(res.headers.get("location")).toBe(next);
  expect(await sessionOk(pw(sessionFrom(res)))).toBe(true);
});

test("an oversized body is a failed login, not a crash", async () => {
  const res = await login({ password: "x".repeat(100_000) });
  expect(res.headers.get("location")).toBe("/login?error=auth&next=%2F");
});

test("logout clears the cookie and goes to the login page (/ when open)", async () => {
  const res = await logoutRoute();
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("/login");
  expect(res.headers.get("set-cookie")).toMatch(new RegExp(`^${SESSION_COOKIE}=; Path=/; Max-Age=0`));
  delete process.env.NOTEFEED_PASSWORD;
  expect((await logoutRoute()).headers.get("location")).toBe("/");
});

test("logout ends a Better Auth session too; with sign-in alone it goes to the login page", async () => {
  process.env.NOTEFEED_PASSWORD = "";
  stubSignInOn();
  const cookie = await signedInCookie();
  const SAME = { host: "localhost:3000", origin: "http://localhost:3000" };
  expect(await sessionOk(new Headers({ ...SAME, cookie }))).toBe(true);
  const res = await logoutRoute(new Request("http://localhost:3000/logout", { method: "POST", headers: { ...SAME, cookie } }));
  expect(res.headers.get("location")).toBe("/login");
  expect(res.headers.getSetCookie().some((c) => /session_token=;/.test(c))).toBe(true);
  expect(await sessionOk(new Headers({ ...SAME, cookie }))).toBe(false); // the session is gone, not only the cookie
  vi.unstubAllEnvs();
});

describe("signed-in session", () => {
  const SAME = { host: "localhost:3000", origin: "http://localhost:3000" };
  let id: string;
  const ok = async (h: Record<string, string>) => {
    try {
      await authorize(new Headers(h), "ip");
      return true;
    } catch (e) {
      if (e instanceof AuthError) return false;
      throw e;
    }
  };
  beforeEach(async () => {
    delete process.env.NOTEFEED_PASSWORD;
    vi.stubEnv("NOTEFEED_SECRET", "a".repeat(40));
    stubSignInOn();
    resetFeedsForTests();
    id = await signedInCookie();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetFeedsForTests();
  });

  test("a same-origin identity cookie authorizes and names the sender", async () => {
    expect(await ok({ ...SAME, cookie: id })).toBe(true);
    expect(await sender(new Headers({ ...SAME, cookie: id }))).toBe("Ann");
  });

  test("cross-origin, or with an Authorization header, the cookie counts for nothing", async () => {
    const cross = { host: "localhost:3000", origin: "https://evil.example", cookie: id };
    expect(await ok(cross)).toBe(false);
    expect(await sender(new Headers(cross))).toBeUndefined();
    expect(await sender(new Headers({ host: "localhost:3000", cookie: id }))).toBeUndefined(); // no Origin
    const withAuth = { ...SAME, cookie: id, authorization: "Bearer x" };
    expect(await ok(withAuth)).toBe(false);
    expect(await sender(new Headers(withAuth))).toBeUndefined();
  });

  test("a tampered or expired session cookie is refused", async () => {
    for (const bad of [id.slice(0, -2) + (id.endsWith("AA") ? "BB" : "AA"), await signedInCookie("Ann", new Date(Date.now() - 1000))]) {
      expect(await ok({ ...SAME, cookie: bad })).toBe(false);
      expect(await sender(new Headers({ ...SAME, cookie: bad }))).toBeUndefined();
    }
  });


  test("an access bearer gives its sender; an expired one, a refresh token or the password bearer none", async () => {
    const bearer = (t: string) => new Headers({ host: "localhost:3000", authorization: `Bearer ${t}` });
    expect(await sender(bearer(sign("access", { aud: "http://localhost:3000/mcp", sender: "Ann" })))).toBe("Ann");
    expect(await sender(bearer(sign("access", { aud: "http://localhost:3000/mcp", sender: "Ann" }, Date.now() - 3601_000)))).toBeUndefined();
    expect(await sender(bearer(sign("refresh", { cid: "c", aud: "a", jti: "j", sender: "Ann" })))).toBeUndefined();
    vi.stubEnv("NOTEFEED_PASSWORD", "pw");
    expect(await sender(bearer("pw"))).toBeUndefined();
  });

  test("sign-in off: a valid session cookie neither authorizes nor names a sender", async () => {
    vi.stubEnv("NOTEFEED_PASSWORD", "pw");
    const cookie = id;
    vi.stubEnv("NOTEFEED_OIDC_ALLOW", "");
    expect(await ok({ ...SAME, cookie })).toBe(false);
    expect(await sender(new Headers({ ...SAME, cookie }))).toBeUndefined();
    expect(await sessionOk(new Headers({ ...SAME, cookie }))).toBe(false);
    vi.stubEnv("NOTEFEED_PASSWORD", "");
    expect(await sender(new Headers({ ...SAME, cookie: id }))).toBeUndefined(); // open instance
    expect(await sender(new Headers({ host: "localhost:3000", authorization: `Bearer ${sign("access", { aud: "a", sender: "Ann" })}` }))).toBeUndefined();
  });
});
