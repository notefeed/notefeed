import Database from "better-sqlite3";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ownNewFeed, resetOwnersForTests } from "../feedlock";
import { ensureFeed, resetFeedsForTests } from "../feeds";
import { migrateAccounts } from "./auth";
import { cleanupEmptyAccounts } from "./cleanup";
import { createAccount } from "./numbers";

const DAY = 86_400_000;
beforeEach(async () => {
  vi.stubEnv("NOTEFEED_SECRET", "test-secret-".padEnd(32, "x"));
  vi.stubEnv("NOTEFEED_PASSWORD", "");
  vi.stubEnv("PUBLIC_URL", "http://localhost:3000");
  vi.stubEnv("NOTEFEED_ACCOUNTS", "open");
  resetFeedsForTests();
  resetOwnersForTests();
  await migrateAccounts();
});
afterEach(() => vi.unstubAllEnvs());

const users = () => {
  const db = new Database(join(process.env.DATA_DIR!, "accounts.sqlite"), { readonly: true });
  try {
    return (db.prepare("select id from user").all() as { id: string }[]).map((r) => r.id);
  } finally {
    db.close();
  }
};

test("an account older than 30 days that owns no feed is deleted; a younger one, or one with a feed, stays", async () => {
  const empty = await createAccount();
  const withFeed = await createAccount();
  await ensureFeed("kept");
  await ownNewFeed("kept", withFeed.userId);
  const young = await createAccount();
  const now = Date.now();
  const db = new Database(join(process.env.DATA_DIR!, "accounts.sqlite"));
  db.prepare("update user set createdAt = ? where id != ?").run(new Date(now - 31 * DAY).toISOString(), young.userId);
  db.close();
  expect(await cleanupEmptyAccounts(now)).toBe(1);
  expect(users().sort()).toEqual([withFeed.userId, young.userId].sort());
  expect(users()).not.toContain(empty.userId);
});

test("only where anyone may create accounts: the operator's (closed) and the provider's stay", async () => {
  await createAccount();
  const db = new Database(join(process.env.DATA_DIR!, "accounts.sqlite"));
  db.prepare("update user set createdAt = ?").run(new Date(Date.now() - 31 * DAY).toISOString());
  db.close();
  vi.stubEnv("NOTEFEED_ACCOUNTS", "closed");
  expect(await cleanupEmptyAccounts()).toBe(0);
  expect(users()).toHaveLength(1);
});

test("every old empty account is found, not only the first page of them", async () => {
  const { accountsAuth } = await import("./auth");
  const ctx = await accountsAuth()!.$context;
  const kept = await createAccount();
  await ensureFeed("kept-too");
  await ownNewFeed("kept-too", kept.userId);
  for (let i = 0; i < 130; i++) await ctx.internalAdapter.createUser({ email: `u${i}@test.invalid`, name: "" }, { method: "admin" });
  const now = Date.now();
  const db = new Database(join(process.env.DATA_DIR!, "accounts.sqlite"));
  db.prepare("update user set createdAt = ?").run(new Date(now - 31 * DAY).toISOString());
  db.close();
  expect(await cleanupEmptyAccounts(now)).toBe(130);
  expect(users()).toEqual([kept.userId]);
}, 30_000);
