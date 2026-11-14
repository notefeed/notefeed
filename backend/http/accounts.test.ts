import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { authRoute, migrateAccounts, signedInSession } from "../accounts/auth";
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

  test("is rate-limited per address", async () => {
    vi.stubEnv("NOTEFEED_RATE_LIMIT", "2");
    await created();
    await created();
    const res = await accountCreateRoute(post("/api/accounts/create", SAME));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
  });
});

describe("signing in with the number and key", () => {
  test("goes to next with the session cookie", async () => {
    const { body } = await created();
    const res = await accountSignInRoute(post("/api/accounts/sign-in", formHeaders(), form({ number: body.number, recoveryKey: body.recoveryKey, next: "/feed" })));
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
    const res = await accountSignInRoute(post("/api/accounts/sign-in", formHeaders({ host: "localhost:3000", origin: "https://evil.example" }), form({ number: body.number, recoveryKey: body.recoveryKey })));
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

  test("creates an account in any mode with accounts, getting the number and key once", async () => {
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
