// Accounts nobody uses (#389): where anyone may create one (`open`), an account older than 30 days that owns no feed is deleted, so
// the file doesn't fill with accounts made and forgotten. Accounts the operator made (`closed`) or an identity provider did
// (`provider`) stay: someone meant them. Licenses on the account (step 3) will keep one too.
import { logger } from "../log";
import { processState } from "../state";
import { accountsAuth } from "./auth";
import { accountsMode } from "./mode";

const DAY = 86_400_000;
export const EMPTY_ACCOUNT_DAYS = 30;
const PAGE = 100;
const log = logger("accounts");

// The accounts deleted. Runs the owners lookup once for all of them.
export async function cleanupEmptyAccounts(now = Date.now()): Promise<number> {
  const auth = accountsAuth();
  if (!auth || accountsMode() !== "open") return 0;
  const { ownedFeeds } = await import("../feedlock");
  const { deleteAccount } = await import("./numbers");
  const ctx = await auth.$context;
  // The accounts older than 30 days, a page at a time (Better Auth answers at most 100 rows unless asked for a limit), oldest first;
  // the next page starts after the ones kept, since the deleted ones are no longer there.
  const before = new Date(now - EMPTY_ACCOUNT_DAYS * DAY);
  let [deleted, kept] = [0, 0];
  for (;;) {
    const page = await ctx.adapter.findMany<{ id: string }>({
      model: "user",
      where: [{ field: "createdAt", operator: "lt", value: before }],
      sortBy: { field: "createdAt", direction: "asc" },
      limit: PAGE,
      offset: kept,
    });
    for (const u of page) {
      if ((await ownedFeeds(u.id)).length) kept++;
      else {
        await deleteAccount(u.id);
        deleted++;
      }
    }
    if (page.length < PAGE) break;
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
