// Accounts nobody uses (#389): where anyone may create one (`open`), an account older than 30 days that owns no feed is deleted, so
// the file doesn't fill with accounts made and forgotten. Accounts the operator made (`closed`) or an identity provider did
// (`provider`) stay: someone meant them. Licenses on the account (step 3) will keep one too.
import { logger } from "../log";
import { processState } from "../state";
import { accountsAuth } from "./auth";
import { accountsMode } from "./mode";

const DAY = 86_400_000;
export const EMPTY_ACCOUNT_DAYS = 30;
const log = logger("accounts");

// The accounts deleted. Runs the owners lookup once for all of them.
export async function cleanupEmptyAccounts(now = Date.now()): Promise<number> {
  const auth = accountsAuth();
  if (!auth || accountsMode() !== "open") return 0;
  const { ownedFeeds } = await import("../feedlock");
  const { deleteAccount } = await import("./numbers");
  const ctx = await auth.$context;
  const users = (await ctx.internalAdapter.listUsers()) as { id: string; createdAt: Date | string }[];
  let deleted = 0;
  for (const u of users) {
    if (now - new Date(u.createdAt).getTime() < EMPTY_ACCOUNT_DAYS * DAY) continue;
    if ((await ownedFeeds(u.id)).length) continue;
    await deleteAccount(u.id);
    deleted++;
  }
  if (deleted) log.info({ deleted }, "accounts without a feed deleted after 30 days"); // how many, never which
  return deleted;
}

// Once at start-up and then daily, in the background; a failure is logged and tried again the next day.
const timer = processState("account-cleanup", () => ({ started: false }));
export function startAccountCleanup(): void {
  if (timer.started) return;
  timer.started = true;
  const run = () => void cleanupEmptyAccounts().catch((e) => log.error({ err: e }, "cleaning up accounts failed"));
  run();
  setInterval(run, DAY).unref();
}
