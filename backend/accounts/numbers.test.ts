import Database from "better-sqlite3";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AuthError } from "../errors";
import { migrateAccounts, signedInName, signedInSession } from "./auth";
import { createAccount, deleteAccount, formatNumber, newRecoveryKey, parseNumber, signInWithNumber } from "./numbers";

const H = { host: "localhost:3000", origin: "http://localhost:3000" };
beforeEach(async () => {
  vi.stubEnv("NOTEFEED_SECRET", "test-secret-".padEnd(32, "x"));
  vi.stubEnv("NOTEFEED_PASSWORD", "");
  vi.stubEnv("PUBLIC_URL", "http://localhost:3000");
  vi.stubEnv("NOTEFEED_ACCOUNTS", "open");
  await migrateAccounts();
});
afterEach(() => vi.unstubAllEnvs());

const rows = (sql: string) => {
  const db = new Database(join(process.env.DATA_DIR!, "accounts.sqlite"), { readonly: true });
  try {
    return db.prepare(sql).all() as Record<string, unknown>[];
  } finally {
    db.close();
  }
};
const cookieHeader = (setCookies: string[]) => setCookies.map((c) => c.split(";")[0]).join("; ");
const session = (setCookies: string[]) => signedInSession(new Headers({ ...H, cookie: cookieHeader(setCookies) }));

test("an account number is 16 digits, shown in groups of four; typed with spaces or dashes it reads back", () => {
  expect(formatNumber("4821093755217764")).toBe("4821-0937-5521-7764");
  expect(parseNumber(" 4821 0937-5521 7764 ")).toBe("4821093755217764");
  expect(parseNumber("4821-0937-5521")).toBeNull();
  expect(parseNumber("4821-0937-5521-776x")).toBeNull();
});

test("a new account has a 16-digit number and a recovery key of at least 20 characters, and nothing about who holds it", async () => {
  const { number, recoveryKey } = await createAccount();
  expect(number).toMatch(/^[1-9]\d{15}$/);
  expect(recoveryKey.replace(/-/g, "").length).toBeGreaterThanOrEqual(20);
  const [user] = rows("select * from user");
  expect(user.email).toBe(`${number}@accounts.invalid`);
  expect(user.name).toBe("");
  expect(JSON.stringify(rows("select * from account"))).not.toContain(recoveryKey);
});

test("two accounts never share a number", async () => {
  const a = await createAccount();
  const b = await createAccount();
  expect(a.number).not.toBe(b.number);
});

test("signing in with the number and key gives a session without a sender name", async () => {
  const { number, recoveryKey } = await createAccount();
  const cookies = await signInWithNumber(formatNumber(number), recoveryKey, new Headers(H));
  const s = await session(cookies);
  expect(s?.userId).toBeDefined();
  expect(s?.name).toBeUndefined();
  expect(await signedInName(new Headers({ ...H, cookie: cookieHeader(cookies) }))).toBeUndefined();
});

test("a wrong key, or a number nobody has, is AuthError and leaves no session", async () => {
  const { number } = await createAccount();
  await expect(signInWithNumber(number, "WRONG-WRONG-WRONG-WRONG-WRONG", new Headers(H))).rejects.toBeInstanceOf(AuthError);
  await expect(signInWithNumber("1111222233334444", "x".repeat(24), new Headers(H))).rejects.toBeInstanceOf(AuthError);
  expect(rows("select * from session")).toHaveLength(0);
});

test("a new recovery key replaces the old one", async () => {
  const { number, recoveryKey, userId } = await createAccount();
  const fresh = await newRecoveryKey(userId);
  expect(fresh).not.toBe(recoveryKey);
  await expect(signInWithNumber(number, recoveryKey, new Headers(H))).rejects.toBeInstanceOf(AuthError);
  expect(await signInWithNumber(number, fresh, new Headers(H))).not.toHaveLength(0);
});

test("deleting an account removes it with its sessions; its number no longer signs in", async () => {
  const { number, recoveryKey, userId } = await createAccount();
  const cookies = await signInWithNumber(number, recoveryKey, new Headers(H));
  await deleteAccount(userId);
  expect(rows("select * from user")).toHaveLength(0);
  expect(rows("select * from session")).toHaveLength(0);
  expect(rows("select * from passkey")).toHaveLength(0);
  expect(await session(cookies)).toBeUndefined();
  await expect(signInWithNumber(number, recoveryKey, new Headers(H))).rejects.toBeInstanceOf(AuthError);
});

test("a number account stays signed in whatever the identity providers' allow-lists say", async () => {
  vi.stubEnv("NOTEFEED_OIDC_ISSUER", "https://idp.example");
  vi.stubEnv("NOTEFEED_OIDC_CLIENT_ID", "id");
  vi.stubEnv("NOTEFEED_OIDC_CLIENT_SECRET", "secret");
  vi.stubEnv("NOTEFEED_OIDC_ALLOW", "nobody@x.com");
  const { number, recoveryKey } = await createAccount();
  expect(await session(await signInWithNumber(number, recoveryKey, new Headers(H)))).toBeDefined();
});

test("with accounts off nothing can be created", async () => {
  vi.stubEnv("NOTEFEED_ACCOUNTS", "off");
  await expect(createAccount()).rejects.toThrow();
});
