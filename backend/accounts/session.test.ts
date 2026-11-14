import Database from "better-sqlite3";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { logTo } from "../log";
import { BASE, type MockProvider, providerEnv, signIn, startProvider } from "../oidc/mockprovider.testkit";
import { resetRateLimitsForTests } from "../limits";
import { resetTokensForTests } from "../oauth/tokens";
import { migrateAccounts, signedInSession } from "./auth";

const DAY = 86_400_000;
const H = { host: "localhost:3000" };
const start = () => new Request(`${BASE}/api/oidc/start?next=/`, { headers: H });

let idp: MockProvider;
beforeAll(async () => {
  idp = await startProvider();
});
afterAll(async () => {
  await idp.stop();
});

let lines: string[];
let restore: () => void;
beforeEach(async () => {
  vi.stubEnv("NOTEFEED_SECRET", "test-secret-".padEnd(32, "x"));
  vi.stubEnv("NOTEFEED_PASSWORD", "");
  vi.stubEnv("PUBLIC_URL", BASE);
  for (const [k, v] of Object.entries(providerEnv(idp, "ann@x.com"))) vi.stubEnv(k, v);
  idp.claims = { name: "Ann", email: "ann@x.com", email_verified: true };
  resetRateLimitsForTests();
  resetTokensForTests();
  await migrateAccounts();
  lines = [];
  restore = logTo((l) => void lines.push(l));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  restore();
});

const sessions = () => {
  const db = new Database(join(process.env.DATA_DIR!, "accounts.sqlite"), { readonly: true });
  try {
    return db.prepare("select expiresAt, createdAt from session").all() as { expiresAt: number; createdAt: number }[];
  } finally {
    db.close();
  }
};
// The session cookie alone, as a browser sends it once the 5-minute cache cookie has run out.
const cookieOf = (header: string) =>
  header
    .split("; ")
    .filter((c) => c.includes("session_token"))
    .join("; ");
async function signedInAt(): Promise<{ cookie: string; withCache: string; at: number }> {
  const { jar } = await signIn(start());
  const at = Date.now();
  vi.useFakeTimers({ toFake: ["Date"], now: at });
  return { cookie: cookieOf(jar.header()), withCache: jar.header(), at };
}
// As the proxy reads it: the only caller that can hand the renewed cookie to the browser.
const read = (cookie: string) => signedInSession(new Headers({ ...H, cookie }), { renew: true });
// As every other caller reads it (an API request, a server component).
const peek = (cookie: string) => signedInSession(new Headers({ ...H, cookie }));
const later = (at: number, days: number) => vi.setSystemTime(at + days * DAY);
const warned = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((e) => e.level === "warn");

test("a session used a day later is renewed: expiresAt is 30 days from then and a Set-Cookie comes back", async () => {
  const { cookie, at } = await signedInAt();
  later(at, 1.5);
  const s = await read(cookie);
  expect(s?.name).toBe("Ann");
  expect(s?.setCookies.some((c) => c.includes("session_token") && /Max-Age=2592000/i.test(c))).toBe(true);
  const [row] = sessions();
  expect(Math.abs(new Date(row.expiresAt).getTime() - (Date.now() + 30 * DAY))).toBeLessThan(60_000);
});

test("a session unused for 30 days has ended", async () => {
  const { cookie, at } = await signedInAt();
  later(at, 31);
  expect(await read(cookie)).toBeUndefined();
});

test("used every day, a sign-in still ends 90 days after it was made", async () => {
  const { cookie, at } = await signedInAt();
  for (let d = 1; d < 90; d += 1) {
    later(at, d);
    expect(await read(cookie), `day ${d}`).toBeDefined();
  }
  later(at, 90.1);
  expect(await read(cookie)).toBeUndefined();
  expect(sessions()).toHaveLength(0);
});

test("taken off the allow-list, the next request is signed out and the session is deleted", async () => {
  const { cookie } = await signedInAt();
  expect(await read(cookie)).toBeDefined();
  vi.stubEnv("NOTEFEED_OIDC_ALLOW", "bob@x.com");
  expect(await read(cookie)).toBeUndefined();
  expect(sessions()).toHaveLength(0);
});

test("a provider no longer configured signs its people out", async () => {
  const { cookie } = await signedInAt();
  for (const k of Object.keys(providerEnv(idp))) vi.stubEnv(k, "");
  for (const [k, v] of Object.entries(providerEnv(idp, "ann@x.com", "OTHER"))) vi.stubEnv(k, v);
  expect(await read(cookie)).toBeUndefined();
});

test("without an address, only a * list keeps the person in", async () => {
  vi.stubEnv("NOTEFEED_OIDC_ALLOW", "*");
  idp.claims = { name: "Ann" };
  const { cookie } = await signedInAt();
  expect(await read(cookie)).toBeDefined();
  vi.stubEnv("NOTEFEED_OIDC_ALLOW", "@x.com");
  expect(await read(cookie)).toBeUndefined();
});

test("a session from before the upgrade (7 days) is renewed, not ended", async () => {
  const { cookie, at } = await signedInAt();
  const db = new Database(join(process.env.DATA_DIR!, "accounts.sqlite"));
  db.prepare("update session set expiresAt = ?").run(new Date(at + 6 * DAY).toISOString());
  db.close();
  expect(new Date(sessions()[0].expiresAt).getTime()).toBe(at + 6 * DAY);
  later(at, 1);
  const s = await read(cookie);
  expect(s?.name).toBe("Ann");
  expect(s?.setCookies.some((c) => c.includes("session_token"))).toBe(true);
});

test("ending a session is logged with the provider and the reason, never who", async () => {
  const { cookie } = await signedInAt();
  vi.stubEnv("NOTEFEED_OIDC_ALLOW", "bob@x.com");
  await read(cookie);
  const line = warned().find((e) => e.msg === "person no longer on the allow-list");
  expect(line).toMatchObject({ provider: "default" });
  expect(JSON.stringify(line)).not.toMatch(/ann|Ann/);
});

test("a read that can't hand the cookie on doesn't renew: the next page does", async () => {
  const { cookie, at } = await signedInAt();
  later(at, 1.5);
  const before = new Date(sessions()[0].expiresAt).getTime();
  expect((await peek(cookie))?.setCookies).toEqual([]);
  expect(new Date(sessions()[0].expiresAt).getTime()).toBe(before);
  expect((await read(cookie))?.setCookies.some((c) => c.includes("session_token"))).toBe(true);
});

test("an ended session is logged once, however often its cookies (with the 5-minute cache) come back", async () => {
  const { withCache } = await signedInAt();
  expect(withCache).toContain("session_data");
  vi.stubEnv("NOTEFEED_OIDC_ALLOW", "bob@x.com");
  await read(withCache);
  await peek(withCache);
  expect(await read(withCache)).toBeUndefined();
  expect(warned().filter((e) => e.msg === "person no longer on the allow-list")).toHaveLength(1);
});

test("a person removed from the file is logged as no longer known", async () => {
  // Better Auth finds no session without its person; the 5-minute cookie cache still brings it.
  const { withCache } = await signedInAt();
  const db = new Database(join(process.env.DATA_DIR!, "accounts.sqlite"));
  // Without the cascade, as a hand edit of the file can leave it: the session outlives its person.
  db.pragma("foreign_keys = off");
  db.prepare("delete from account").run();
  db.prepare("delete from user").run();
  db.close();
  expect(await read(withCache)).toBeUndefined();
  expect(warned().map((e) => e.msg)).toContain("person no longer known");
});
