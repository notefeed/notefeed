import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import Database from "better-sqlite3";
import { join } from "node:path";
import { authRoute, migrateAccounts, signedInSession } from "../accounts/auth";
import { checkAccessSettings } from "../accounts/mode";
import { resetRateLimitsForTests } from "../limits";
import { accountCreateRoute, accountDeleteRoute, accountSignInRoute, recoveryKeyRoute } from "./accounts";
import { operatorAccountsRoute } from "./operator";

const BASE = "http://localhost:3000";
const SAME = { host: "localhost:3000", origin: BASE };
const TOKEN = "t".repeat(40);
beforeEach(async () => {
  vi.stubEnv("NOTEFEED_SECRET", "test-secret-".padEnd(32, "x"));
  vi.stubEnv("NOTEFEED_PASSWORD", "");
  vi.stubEnv("PUBLIC_URL", BASE);
  vi.stubEnv("NOTEFEED_ACCOUNTS", "open");
  vi.stubEnv("NOTEFEED_OPERATOR_TOKEN", TOKEN);
  resetRateLimitsForTests();
  await migrateAccounts();
});
afterEach(() => vi.unstubAllEnvs());

const post = (path: string, headers: Record<string, string>, body?: BodyInit) => new Request(BASE + path, { method: "POST", headers, body });
const form = (fields: Record<string, string>) => new URLSearchParams(fields);
const formHeaders = (h: Record<string, string> = SAME) => ({ ...h, "content-type": "application/x-www-form-urlencoded" });
const cookieOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
async function created() {
  const res = await accountCreateRoute(post("/api/accounts/create", SAME));
  return { res, body: (await res.json()) as { number: string; recoveryKey: string }, cookie: cookieOf(res) };
}

describe("creating an account", () => {
  test("from the instance's own page: the number (grouped) and key once, and signed in", async () => {
    const { res, body, cookie } = await created();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(body.number).toMatch(/^\d{4}-\d{4}-\d{4}-\d{4}$/);
    expect(body.recoveryKey).toMatch(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){4}$/);
    expect(await signedInSession(new Headers({ ...SAME, cookie }))).toBeDefined();
  });

  test("from another site, or with accounts not open, is refused", async () => {
    expect((await accountCreateRoute(post("/api/accounts/create", { host: "localhost:3000", origin: "https://evil.example" }))).status).toBe(403);
    vi.stubEnv("NOTEFEED_ACCOUNTS", "closed");
    expect((await accountCreateRoute(post("/api/accounts/create", SAME))).status).toBe(403);
    vi.stubEnv("NOTEFEED_ACCOUNTS", "off");
    expect((await accountCreateRoute(post("/api/accounts/create", SAME))).status).toBe(404);
  });
});

describe("signing in with the number and key", () => {
  test("goes to next with the session cookie", async () => {
    const { body } = await created();
    const res = await accountSignInRoute(
      post("/api/accounts/sign-in", formHeaders(), form({ number: body.number, recoveryKey: body.recoveryKey, next: "/feed" })),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/feed");
    expect(await signedInSession(new Headers({ ...SAME, cookie: cookieOf(res) }))).toBeDefined();
  });

  test("a wrong key goes back to /login with the error and counts toward the limit", async () => {
    vi.stubEnv("NOTEFEED_RATE_LIMIT", "2");
    const { body } = await created();
    const wrong = () => accountSignInRoute(post("/api/accounts/sign-in", formHeaders(), form({ number: body.number, recoveryKey: "X".repeat(25), next: "/" })));
    expect((await wrong()).headers.get("location")).toBe("/login?error=auth");
    await wrong();
    expect((await wrong()).headers.get("location")).toMatch(/^\/login\?error=too_many_attempts&retry=\d+/);
  });

  test("from another site is refused", async () => {
    const { body } = await created();
    const res = await accountSignInRoute(
      post(
        "/api/accounts/sign-in",
        formHeaders({ host: "localhost:3000", origin: "https://evil.example" }),
        form({ number: body.number, recoveryKey: body.recoveryKey }),
      ),
    );
    expect(res.status).toBe(403);
  });
});

describe("while signed in", () => {
  test("a new recovery key is returned once and replaces the old one", async () => {
    const { body, cookie } = await created();
    const res = await recoveryKeyRoute(post("/api/accounts/recovery-key", { ...SAME, cookie }));
    expect(res.status).toBe(200);
    const { recoveryKey } = await res.json();
    expect(recoveryKey).not.toBe(body.recoveryKey);
    const old = await accountSignInRoute(post("/api/accounts/sign-in", formHeaders(), form({ number: body.number, recoveryKey: body.recoveryKey })));
    expect(old.headers.get("location")).toMatch(/^\/login\?error=/);
  });

  test("a new key needs the session from the instance's own page", async () => {
    const { cookie } = await created();
    expect((await recoveryKeyRoute(post("/api/accounts/recovery-key", SAME))).status).toBe(401);
    expect((await recoveryKeyRoute(post("/api/accounts/recovery-key", { host: "localhost:3000", origin: "https://evil.example", cookie }))).status).toBe(403);
  });

  test("deleting the account needs its number typed again; then it is gone and signed out", async () => {
    const { body, cookie } = await created();
    const wrong = await accountDeleteRoute(post("/api/accounts/delete", formHeaders({ ...SAME, cookie }), form({ confirm: "1111-2222-3333-4444" })));
    expect(wrong.headers.get("location")).toBe("/account?error=confirm");
    const res = await accountDeleteRoute(post("/api/accounts/delete", formHeaders({ ...SAME, cookie }), form({ confirm: body.number })));
    expect(res.headers.get("location")).toBe("/");
    expect(await signedInSession(new Headers({ ...SAME, cookie }))).toBeUndefined();
    const again = await accountSignInRoute(post("/api/accounts/sign-in", formHeaders(), form({ number: body.number, recoveryKey: body.recoveryKey })));
    expect(again.headers.get("location")).toMatch(/^\/login\?error=/);
  });
});

describe("the operator", () => {
  const op = (method: string, query = "") => new Request(`${BASE}/api/operator/accounts${query}`, { method, headers: { authorization: `Bearer ${TOKEN}` } });

  test("creates an account where accounts are closed, getting the number and key once", async () => {
    vi.stubEnv("NOTEFEED_ACCOUNTS", "closed");
    const res = await operatorAccountsRoute(op("POST"));
    expect(res.status).toBe(201);
    const { number, recoveryKey } = await res.json();
    const signIn = await accountSignInRoute(post("/api/accounts/sign-in", formHeaders(), form({ number, recoveryKey })));
    expect(signIn.headers.get("location")).toBe("/");
  });

  test("deletes one by its number; an unknown number is 404", async () => {
    const { number } = await (await operatorAccountsRoute(op("POST"))).json();
    expect((await operatorAccountsRoute(op("DELETE", `?number=${number}`))).status).toBe(204);
    expect((await operatorAccountsRoute(op("DELETE", `?number=${number}`))).status).toBe(404);
  });

  test("doesn't make number accounts where they come from the identity provider", async () => {
    vi.stubEnv("NOTEFEED_ACCOUNTS", "provider");
    vi.stubEnv("NOTEFEED_OIDC_ISSUER", "https://idp.example");
    vi.stubEnv("NOTEFEED_OIDC_CLIENT_ID", "id");
    vi.stubEnv("NOTEFEED_OIDC_CLIENT_SECRET", "secret");
    vi.stubEnv("NOTEFEED_OIDC_ALLOW", "*");
    expect((await operatorAccountsRoute(op("POST"))).status).toBe(409);
  });

  test("needs the operator token, and accounts on", async () => {
    expect((await operatorAccountsRoute(new Request(`${BASE}/api/operator/accounts`, { method: "POST" }))).status).toBe(401);
    vi.stubEnv("NOTEFEED_ACCOUNTS", "off");
    expect((await operatorAccountsRoute(op("POST"))).status).toBe(404);
  });
});

test("a browser reaches Better Auth's passkey endpoints, and still not its e-mail sign-up or sign-in", async () => {
  const at = (path: string) => authRoute(new Request(BASE + path, { method: "POST", headers: { ...SAME, "content-type": "application/json" }, body: "{}" }));
  const options = await authRoute(new Request(`${BASE}/api/auth/passkey/generate-authenticate-options`, { headers: SAME }));
  expect(options.status).toBe(200);
  expect(await options.json()).toHaveProperty("challenge");
  expect((await at("/api/auth/sign-up/email")).status).toBe(404);
  expect((await at("/api/auth/sign-in/email")).status).toBe(404);
  expect((await at("/api/auth/sign-in/username")).status).toBe(404);
});

// Makes every session of the account look `days` old, as a stolen cookie from a while ago would be.
const age = (days: number) => {
  const db = new Database(join(process.env.DATA_DIR!, "accounts.sqlite"));
  db.prepare("update session set createdAt = ?").run(new Date(Date.now() - days * 86_400_000).toISOString());
  db.close();
};
const signInAgain = async (number: string, recoveryKey: string) =>
  cookieOf(await accountSignInRoute(post("/api/accounts/sign-in", formHeaders(), form({ number, recoveryKey }))));

describe("what a session alone can't do (review)", () => {
  test("a new recovery key signs every other session out", async () => {
    const { body, cookie } = await created();
    const other = await signInAgain(body.number, body.recoveryKey);
    const res = await recoveryKeyRoute(post("/api/accounts/recovery-key", { ...SAME, cookie }));
    expect(res.status).toBe(200);
    expect(await signedInSession(new Headers({ ...SAME, cookie: other }))).toBeUndefined();
    expect(await signedInSession(new Headers({ ...SAME, cookie }))).toBeDefined();
  });

  test("a new recovery key, deleting the account or removing a passkey need a sign-in from the last day", async () => {
    const { body, cookie } = await created();
    age(2);
    const key = await recoveryKeyRoute(post("/api/accounts/recovery-key", { ...SAME, cookie }));
    expect(key.status).toBe(403);
    expect(await key.json()).toEqual({ error: "sign in again" });
    const del = await accountDeleteRoute(post("/api/accounts/delete", formHeaders({ ...SAME, cookie }), form({ confirm: body.number })));
    expect(del.headers.get("location")).toBe("/account?error=fresh");
    const passkey = await authRoute(
      post("/api/auth/passkey/delete-passkey", { ...SAME, cookie, "content-type": "application/json" }, JSON.stringify({ id: "x" })),
    );
    expect(passkey.status).toBe(403);
  });
});

test("Better Auth's passkey endpoints that need no session are rate-limited per address", async () => {
  vi.stubEnv("NOTEFEED_RATE_LIMIT", "2");
  const options = () => authRoute(new Request(`${BASE}/api/auth/passkey/generate-authenticate-options`, { headers: SAME }));
  await options();
  await options();
  const res = await options();
  expect(res.status).toBe(429);
  expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
});

test("creating accounts has its own, tighter limit: 10 an hour per address", async () => {
  vi.stubEnv("NOTEFEED_RATE_LIMIT", "1000");
  for (let i = 0; i < 10; i++) expect((await accountCreateRoute(post("/api/accounts/create", SAME))).status).toBe(200);
  expect((await accountCreateRoute(post("/api/accounts/create", SAME))).status).toBe(429);
});

describe("provider mode: every account comes from the identity provider (review)", () => {
  const provider = () => {
    vi.stubEnv("NOTEFEED_OIDC_ISSUER", "https://idp.example");
    vi.stubEnv("NOTEFEED_OIDC_CLIENT_ID", "id");
    vi.stubEnv("NOTEFEED_OIDC_CLIENT_SECRET", "secret");
    vi.stubEnv("NOTEFEED_OIDC_ALLOW", "*");
  };

  test("a number account made before switching to provider can't sign in, and its session ends", async () => {
    const { body, cookie } = await created();
    provider();
    vi.stubEnv("NOTEFEED_ACCOUNTS", "provider");
    const res = await accountSignInRoute(post("/api/accounts/sign-in", formHeaders(), form({ number: body.number, recoveryKey: body.recoveryKey })));
    expect(res.status).toBe(404);
    expect(await signedInSession(new Headers({ ...SAME, cookie }))).toBeUndefined();
  });

  test("closed accounts with an identity provider refuse to start: its sign-ins would create accounts", () => {
    provider();
    vi.stubEnv("NOTEFEED_ACCOUNTS", "closed");
    expect(() => checkAccessSettings()).toThrow(/closed.*identity provider/);
  });
});

test("a passkey's name is one line of at most 50 characters: anything else is refused before Better Auth sees it", async () => {
  const { cookie } = await created();
  const register = (name: unknown) =>
    authRoute(post("/api/auth/passkey/verify-registration", { ...SAME, cookie, "content-type": "application/json" }, JSON.stringify({ response: {}, name })));
  for (const bad of ["a".repeat(51), "two\nlines", "evil‮override", 7]) {
    const res = await register(bad);
    expect(res.status, String(bad)).toBe(400);
    expect(await res.json()).toEqual({ error: "a passkey's name is one line of at most 50 characters" });
  }
  // A fine name (or none) reaches Better Auth, which then refuses the empty WebAuthn response itself, in its own words.
  for (const fine of ["Work laptop", undefined]) expect(await (await register(fine)).json()).toHaveProperty("message");
});
