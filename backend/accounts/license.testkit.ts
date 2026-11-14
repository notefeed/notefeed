// Tests only: licenses on accounts (#391) without a payment provider's round trip. Turns on the fake provider and open accounts, makes
// an account with a subscription of `units`, and puts feeds under it. Nothing here is reachable from the app.
import { vi } from "vitest";
import { migrateAccounts } from "./auth";
import { createAccount } from "./numbers";
import { putSubscription } from "./subscriptions";

let n = 0;

export async function stubLicensing(): Promise<void> {
  vi.stubEnv("NOTEFEED_PAYMENT_PROVIDER", "fake");
  vi.stubEnv("NOTEFEED_FAKE_WEBHOOK_SECRET", "whsec");
  vi.stubEnv("NOTEFEED_ACCOUNTS", "open");
  vi.stubEnv("NOTEFEED_PASSWORD", "");
  if (!process.env.NOTEFEED_SECRET) vi.stubEnv("NOTEFEED_SECRET", "a".repeat(40));
  if (!process.env.PUBLIC_URL) vi.stubEnv("PUBLIC_URL", "http://localhost:3000");
  await migrateAccounts();
}

// An account with a subscription of `units` feeds (active, no end), and its id; `feeds` are made its own and put under the license.
export async function licensedAccount(units = 1, feeds: string[] = []): Promise<{ userId: string; number: string; recoveryKey: string }> {
  const account = await createAccount();
  await putSubscription({
    providerRef: `sub_test_${++n}_${Date.now()}`,
    account: account.userId,
    customerRef: "cust_test",
    period: "month",
    units,
    validUntil: null,
  });
  const { ensureFeed } = await import("../feeds");
  const { ownNewFeed, setCovered } = await import("../feedlock");
  for (const f of feeds) {
    await ensureFeed(f);
    await ownNewFeed(f, account.userId);
    await setCovered(f, account.userId, true, units);
  }
  return account;
}
