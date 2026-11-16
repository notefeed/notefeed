// Reserved feeds on an instance with accounts (#389): owned by NOTEFEED_OPERATOR_ACCOUNT, created without a password or a note.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { migrateAccounts } from "./accounts/auth";
import { createAccount, formatNumber } from "./accounts/numbers";
import { feedOwner, protectedFeed, resetOwnersForTests } from "./feedlock";
import { listFeeds, readIdOf, resetFeedsForTests } from "./feeds";
import { startupReport } from "./startup";

beforeEach(async () => {
  vi.stubEnv("NOTEFEED_SECRET", "test-secret-".padEnd(32, "x"));
  vi.stubEnv("NOTEFEED_PASSWORD", "");
  vi.stubEnv("PUBLIC_URL", "http://localhost:3000");
  vi.stubEnv("NOTEFEED_ACCOUNTS", "open");
  vi.stubEnv("NOTEFEED_RESERVED_FEEDS", "releases,news");
  resetFeedsForTests();
  resetOwnersForTests();
  await migrateAccounts();
});
afterEach(() => vi.unstubAllEnvs());

test("each reserved feed is made owned by the operator's account, open (its owner gives it passwords), read id = name", async () => {
  const { number, userId } = await createAccount();
  vi.stubEnv("NOTEFEED_OPERATOR_ACCOUNT", formatNumber(number));
  vi.stubEnv("NOTEFEED_RESERVED_PASSWORD", "ignored-with-accounts");
  expect(await listFeeds()).toEqual(expect.arrayContaining(["releases", "news"]));
  expect(await feedOwner("releases")).toBe(userId);
  expect(await protectedFeed("releases")).toBe(false);
  expect(await readIdOf("news")).toBe("news");
});

test("without NOTEFEED_OPERATOR_ACCOUNT, or with one that doesn't exist, nothing is made, and start-up says why", async () => {
  vi.stubEnv("NOTEFEED_RESERVED_PASSWORD", "ignored-with-accounts");
  expect(await listFeeds()).toEqual([]);
  expect(startupReport().warnings.map(([, msg]) => msg)).toContain("reserved feeds are listed but NOTEFEED_OPERATOR_ACCOUNT is not set; they are not created");
  resetFeedsForTests();
  vi.stubEnv("NOTEFEED_OPERATOR_ACCOUNT", "1111-2222-3333-4444");
  expect(await listFeeds()).toEqual([]);
});
