import Database from "better-sqlite3";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { InvalidBodyError, NotFoundError } from "../errors";
import { migrateAccounts } from "./auth";
import { createAccount, deleteAccount } from "./numbers";
import { createAccountToken, listAccountTokens, revokeAccountToken, tokenAccount } from "./tokens";

beforeEach(async () => {
  vi.stubEnv("NOTEFEED_SECRET", "test-secret-".padEnd(32, "x"));
  vi.stubEnv("NOTEFEED_PASSWORD", "");
  vi.stubEnv("PUBLIC_URL", "http://localhost:3000");
  vi.stubEnv("NOTEFEED_ACCOUNTS", "open");
  await migrateAccounts();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

test("a token is shown once, starts nf_, names its account and scope, and is stored hashed", async () => {
  const { userId } = await createAccount();
  const t = await createAccountToken(userId, "backup script", "read+write");
  expect(t.token).toMatch(/^nf_[A-Za-z0-9_-]{20,}$/);
  expect(await tokenAccount(t.token)).toEqual({ userId, write: true });
  const db = new Database(join(process.env.DATA_DIR!, "accounts.sqlite"), { readonly: true });
  expect(JSON.stringify(db.prepare("select * from apikey").all())).not.toContain(t.token.slice(3));
  db.close();
});

test("a read token can't write; listing shows name, scope and expiry, never the token", async () => {
  const { userId } = await createAccount();
  const t = await createAccountToken(userId, "reader", "read");
  expect(await tokenAccount(t.token)).toEqual({ userId, write: false });
  const [listed] = await listAccountTokens(userId);
  expect(listed).toMatchObject({ id: t.id, name: "reader", scope: "read" });
  expect(Date.parse(listed.expiresAt!) - Date.now()).toBeGreaterThan(89 * 86_400_000);
  expect(JSON.stringify(listed)).not.toContain(t.token);
});

test("a revoked, expired or unknown token is none; another account can't revoke it", async () => {
  const a = await createAccount();
  const b = await createAccount();
  const t = await createAccountToken(a.userId, "x", "read+write");
  await expect(revokeAccountToken(b.userId, t.id)).rejects.toBeInstanceOf(NotFoundError);
  await revokeAccountToken(a.userId, t.id);
  expect(await tokenAccount(t.token)).toBeUndefined();
  expect(await tokenAccount("nf_nonsense")).toBeUndefined();
  const short = await createAccountToken(a.userId, "short", "read", 1);
  vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 2 * 86_400_000 });
  expect(await tokenAccount(short.token)).toBeUndefined();
});

test("a deleted account's tokens stop working", async () => {
  const { userId } = await createAccount();
  const t = await createAccountToken(userId, "x", "read+write");
  await deleteAccount(userId);
  expect(await tokenAccount(t.token)).toBeUndefined();
});

test("a name is one line of 1 to 50 characters; the scope is read or read+write; 1 to 365 days", async () => {
  const { userId } = await createAccount();
  await expect(createAccountToken(userId, "", "read")).rejects.toBeInstanceOf(InvalidBodyError);
  await expect(createAccountToken(userId, "x".repeat(51), "read")).rejects.toBeInstanceOf(InvalidBodyError);
  await expect(createAccountToken(userId, "x", "admin" as never)).rejects.toBeInstanceOf(InvalidBodyError);
  await expect(createAccountToken(userId, "x", "read", 366)).rejects.toBeInstanceOf(InvalidBodyError);
});
