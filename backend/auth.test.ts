import { createHmac } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SESSION_COOKIE, bearerOf, checkBearer, locked, login, sessionOk } from "./auth";
import { signedInCookie, stubSignInOn } from "./accounts/signin.testkit";
import { resetFeedsForTests } from "./feeds";
import { AuthError, TooManyAttemptsError } from "./errors";
import { resetRateLimitsForTests } from "./limits";
import { resetSecretForTests } from "./secret";

// A request carrying the password session cookie `v` (none when undefined).
const pw = (v: string | undefined) => new Headers(v === undefined ? {} : { cookie: `${SESSION_COOKIE}=${v}` });

beforeEach(() => {
  process.env.NOTEFEED_PASSWORD = "s3cret";
  vi.stubEnv("NOTEFEED_SECRET", "a".repeat(40));
  resetFeedsForTests();
  resetRateLimitsForTests();
  resetSecretForTests();
});
afterEach(() => {
  delete process.env.NOTEFEED_RATE_LIMIT;
  vi.unstubAllEnvs();
  resetFeedsForTests();
});

// The thrown error, or null if the call passed.
const thrown = (f: () => unknown) => {
  try {
    f();
    return null;
  } catch (e) {
    return e;
  }
};

test("locked follows NOTEFEED_PASSWORD", () => {
  expect(locked()).toBe(true);
  delete process.env.NOTEFEED_PASSWORD;
  expect(locked()).toBe(false);
});

test("checkBearer accepts only the exact password when locked", () => {
  expect(thrown(() => checkBearer("Bearer s3cret", "ip"))).toBeNull();
  for (const h of ["Bearer wrong", "Bearer s3cret2", "Bearer S3cret", "s3cret", null, "Bearer "])
    expect(thrown(() => checkBearer(h, "ip"))).toBeInstanceOf(AuthError);
});

test("bearerOf", () => {
  expect(bearerOf("Bearer x")).toBe("x");
  expect(bearerOf("bearer x")).toBe("x");
  expect(bearerOf("Bearer  x")).toBe("x");
  for (const h of ["Bearer ", "Bearer", "Basic x", "x", "", null]) expect(bearerOf(h)).toBe("");
});

test("login: after NOTEFEED_RATE_LIMIT failures the IP must wait, even with the right password", () => {
  process.env.NOTEFEED_RATE_LIMIT = "3";
  for (let i = 0; i < 3; i++) expect(thrown(() => login("wrong", "a"))).toBeInstanceOf(AuthError);
  const e = thrown(() => login("s3cret", "a"));
  expect(e).toBeInstanceOf(TooManyAttemptsError);
  expect((e as TooManyAttemptsError).retryAfter).toBeGreaterThanOrEqual(1);
  expect((e as TooManyAttemptsError).retryAfter).toBeLessThanOrEqual(60);
  expect(thrown(() => login("s3cret", "b"))).toBeNull(); // other IPs unaffected
});

test("login: successes are not counted", () => {
  process.env.NOTEFEED_RATE_LIMIT = "3";
  for (let i = 0; i < 5; i++) login("s3cret", "a");
  expect(thrown(() => login("wrong", "a"))).toBeInstanceOf(AuthError);
});

test("the session value is not the password and verifies only for the current password", async () => {
  const v = login("s3cret", "ip");
  expect(v).not.toContain("s3cret");
  expect(await sessionOk(pw(v))).toBe(true);
  expect(await sessionOk(pw(undefined))).toBe(false);
  expect(await sessionOk(pw("nope"))).toBe(false);
  process.env.NOTEFEED_PASSWORD = "other";
  expect(await sessionOk(pw(v))).toBe(false);
});

// #374: the server secret is in the session value, so a leaked cookie can't be used to guess the password offline.
test("the session value depends on the server secret too", async () => {
  const v = login("s3cret", "ip");
  vi.stubEnv("NOTEFEED_SECRET", "b".repeat(40));
  resetSecretForTests();
  expect(await sessionOk(pw(v))).toBe(false);
  expect(await sessionOk(pw(login("s3cret", "ip")))).toBe(true);
});

test("a session value made from the password alone, as before #374, is refused", async () => {
  const old = createHmac("sha256", "s3cret").update("notefeed-session").digest("hex");
  expect(await sessionOk(pw(old))).toBe(false);
});

test("unlocked: bearer and session always pass, login never does and is never counted", async () => {
  delete process.env.NOTEFEED_PASSWORD;
  process.env.NOTEFEED_RATE_LIMIT = "1";
  for (let i = 0; i < 3; i++) {
    expect(thrown(() => checkBearer(null, "ip"))).toBeNull();
    expect(thrown(() => checkBearer("Bearer anything", "ip"))).toBeNull();
    expect(thrown(() => login("", "ip"))).toBeInstanceOf(AuthError); // never a TooManyAttemptsError
  }
  expect(await sessionOk(pw(undefined))).toBe(true);
});

test("an empty NOTEFEED_PASSWORD counts as unlocked", () => {
  process.env.NOTEFEED_PASSWORD = "";
  expect(locked()).toBe(false);
  expect(thrown(() => login("", "ip"))).toBeInstanceOf(AuthError);
});

test("sign-in without a password locks the instance, and an unset password never matches", async () => {
  delete process.env.NOTEFEED_PASSWORD;
  process.env.NOTEFEED_OIDC_ISSUER = "https://idp.example";
  process.env.NOTEFEED_OIDC_CLIENT_ID = "id";
  process.env.NOTEFEED_OIDC_CLIENT_SECRET = "secret";
  process.env.NOTEFEED_OIDC_ALLOW = "*";
  try {
    expect(locked()).toBe(true);
    expect(thrown(() => checkBearer("Bearer ", "ip"))).toBeInstanceOf(AuthError);
    expect(thrown(() => login("", "ip"))).toBeInstanceOf(AuthError);
    expect(await sessionOk(pw(createHmac("sha256", "").update("notefeed-session").digest("hex")))).toBe(false);
  } finally {
    for (const n of ["ISSUER", "CLIENT_ID", "CLIENT_SECRET", "ALLOW"]) delete process.env[`NOTEFEED_OIDC_${n}`];
  }
  expect(locked()).toBe(false);
});

test("sign-in on, no password: a Better Auth session is a session; a forged or expired one is not", async () => {
  delete process.env.NOTEFEED_PASSWORD;
  stubSignInOn();
  const h = (cookie?: string) => new Headers(cookie ? { cookie } : {});
  const cookie = await signedInCookie();
  expect(await sessionOk(h(cookie))).toBe(true);
  expect(await sessionOk(h())).toBe(false);
  expect(await sessionOk(h(cookie.slice(0, -2) + (cookie.endsWith("AA") ? "BB" : "AA")))).toBe(false);
  expect(await sessionOk(h(await signedInCookie("Ann", new Date(Date.now() - 1000))))).toBe(false);
  vi.stubEnv("NOTEFEED_SECRET", "b".repeat(40));
  resetFeedsForTests();
  expect(await sessionOk(h(cookie))).toBe(false);
});

test("sign-in on with a password: either session passes", async () => {
  stubSignInOn();
  expect(await sessionOk(new Headers({ cookie: `${SESSION_COOKIE}=${login("s3cret", "ip")}` }))).toBe(true);
  expect(await sessionOk(new Headers({ cookie: await signedInCookie() }))).toBe(true);
});

test("sign-in off: a Better Auth cookie is no session", async () => {
  stubSignInOn();
  const cookie = await signedInCookie();
  for (const n of ["ISSUER", "CLIENT_ID", "CLIENT_SECRET", "ALLOW"]) vi.stubEnv(`NOTEFEED_OIDC_${n}`, "");
  expect(await sessionOk(new Headers({ cookie }))).toBe(false);
});
