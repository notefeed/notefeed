import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";

// A creation that loses to an existing feed, and a delete of that feed lands between the lost rename and the creation's look at the
// winner: the delete takes the directory away and drops the entry, and the creation must not register the name again (it would be
// listed with no directory: backend/http/feeds.test.ts "delete racing a creation" hit this on CI's timing). The fake rename runs the
// delete exactly there.
let deleteInBetween: (() => Promise<unknown>) | undefined;
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    rename: vi.fn(async (from: string, to: string) => {
      try {
        return await fs.rename(from, to);
      } catch (e) {
        const run = String(from).endsWith(".tmp") ? deleteInBetween : undefined;
        deleteInBetween = undefined;
        await run?.();
        throw e;
      }
    }),
  };
});

test("a creation that lost to a feed deleted meanwhile doesn't list the name", async () => {
  const dir = await mkdtemp(join(tmpdir(), "notefeed-race-"));
  process.env.DATA_DIR = dir;
  process.env.NOTEFEED_SECRET = "x".repeat(32);
  const { createProtectedFeed, deleteFeed, ensureFeed, hasFeed } = await import("../../feeds");
  await ensureFeed("race");
  deleteInBetween = () => deleteFeed("race");
  expect(await createProtectedFeed("race", "hash")).toBe(false); // the feed was there when it tried
  const onDisk = await stat(join(dir, "race")).then(() => true, () => false);
  expect(onDisk).toBe(false);
  expect(await hasFeed("race")).toBe(false);
});
