// Owners and several named feed passwords (ADR 0059): the feed lock's side.
import { beforeEach, describe, expect, test } from "vitest";
import { AuthError, FeedOwnedError, InvalidBodyError, NotFoundError, OwnerOnlyError } from "./errors";
import {
  addFeedPassword,
  changePassword,
  checkFeedAccess,
  claimFeed,
  createProtected,
  feedOwner,
  feedOwnership,
  feedUnlocked,
  listFeedPasswords,
  ownedFeeds,
  ownNewFeed,
  protectedFeed,
  removePassword,
  requireOwner,
  requireOwnerIfOwned,
  resetOwnersForTests,
  revokeFeedPassword,
  setFeedOwner,
  unlock,
} from "./feedlock";
import { ensureFeed, resetFeedsForTests } from "./feeds";
import { resetRateLimitsForTests } from "./limits";
import { storage } from "./storage";

const IP = "1.2.3.4";
beforeEach(() => {
  process.env.NOTEFEED_SECRET = "test-secret-".padEnd(32, "x");
  delete process.env.NOTEFEED_RATE_LIMIT;
  resetFeedsForTests();
  resetRateLimitsForTests();
  resetOwnersForTests();
});
const open = async (feed: string) => void (await ensureFeed(feed));

describe("claiming", () => {
  test("a protected feed is claimed with its password, which stays as 'Feed password'", async () => {
    await createProtected("p", "old-password");
    await claimFeed("p", "ann", "old-password", IP);
    expect(await feedOwner("p")).toBe("ann");
    expect(await listFeedPasswords("p", "ann")).toEqual([{ id: "feed-password", name: "Feed password", created: null }]);
    await expect(checkFeedAccess("p", { password: "old-password" }, IP)).resolves.toBe(true);
  });

  test("a wrong password claims nothing and is a failed attempt", async () => {
    await createProtected("p", "old-password");
    await expect(claimFeed("p", "ann", "wrong", IP)).rejects.toBeInstanceOf(AuthError);
    expect(await feedOwner("p")).toBeUndefined();
  });

  test("an open feed is claimed by giving it a password", async () => {
    await open("o");
    await expect(claimFeed("o", "ann", "", IP)).rejects.toBeInstanceOf(InvalidBodyError);
    const cookie = await claimFeed("o", "ann", "new-password", IP);
    expect(await protectedFeed("o")).toBe(true);
    expect(await feedUnlocked("o", cookie)).toBe("unlocked");
  });

  test("an owned feed can't be claimed, not even with its password", async () => {
    await createProtected("p", "old-password");
    await claimFeed("p", "ann", "old-password", IP);
    await expect(claimFeed("p", "bob", "old-password", IP)).rejects.toBeInstanceOf(FeedOwnedError);
  });

  test("a feed that doesn't exist is NotFound", async () => {
    await expect(claimFeed("nope", "ann", "x".repeat(12), IP)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("the owner's feed passwords", () => {
  async function owned() {
    await createProtected("f", "first-password");
    await claimFeed("f", "ann", "first-password", IP);
  }

  test("the owner adds named passwords; each is shown once and opens the feed", async () => {
    await owned();
    const a = await addFeedPassword("f", "ann", "blog script");
    const b = await addFeedPassword("f", "ann", "Anna");
    expect(a.password).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect((await listFeedPasswords("f", "ann")).map((p) => p.name)).toEqual(["Feed password", "blog script", "Anna"]);
    expect(JSON.stringify(await listFeedPasswords("f", "ann"))).not.toContain(a.password);
    await expect(checkFeedAccess("f", { password: a.password }, IP)).resolves.toBe(true);
    await expect(checkFeedAccess("f", { password: b.password }, IP)).resolves.toBe(true);
  });

  test("revoking one stops it and its cookies at once; the others keep working", async () => {
    await owned();
    const a = await addFeedPassword("f", "ann", "blog script");
    const b = await addFeedPassword("f", "ann", "Anna");
    const cookie = await unlock("f", a.password, IP);
    await revokeFeedPassword("f", "ann", a.id);
    await expect(checkFeedAccess("f", { password: a.password }, IP)).rejects.toBeInstanceOf(AuthError);
    expect(await feedUnlocked("f", cookie)).toBe("locked");
    await expect(checkFeedAccess("f", { password: b.password }, IP)).resolves.toBe(true);
  });

  test("revoking the last leaves the feed open, still the owner's", async () => {
    await owned();
    await revokeFeedPassword("f", "ann", "feed-password");
    expect(await protectedFeed("f")).toBe(false);
    expect(await feedOwner("f")).toBe("ann");
  });

  test("a feed password holder, or another account, can't manage them, nor change or remove the old single password", async () => {
    await owned();
    await expect(addFeedPassword("f", "bob", "x")).rejects.toBeInstanceOf(OwnerOnlyError);
    await expect(addFeedPassword("f", undefined, "x")).rejects.toBeInstanceOf(OwnerOnlyError);
    await expect(listFeedPasswords("f", "bob")).rejects.toBeInstanceOf(OwnerOnlyError);
    await expect(revokeFeedPassword("f", "bob", "feed-password")).rejects.toBeInstanceOf(OwnerOnlyError);
    await expect(changePassword("f", "first-password", "another-password", IP)).rejects.toBeInstanceOf(OwnerOnlyError);
    await expect(removePassword("f", "first-password", IP)).rejects.toBeInstanceOf(OwnerOnlyError);
  });

  test("a password's name is one line of 1 to 50 characters, trimmed", async () => {
    await owned();
    expect((await addFeedPassword("f", "ann", " padded ")).name).toBe("padded");
    for (const bad of ["", "two\nlines", "x".repeat(51)]) await expect(addFeedPassword("f", "ann", bad)).rejects.toBeInstanceOf(InvalidBodyError);
  });

  test("the owner passes without a password; nobody else does", async () => {
    await owned();
    await expect(checkFeedAccess("f", { account: "ann" }, IP)).resolves.toBe(true);
    await expect(checkFeedAccess("f", { account: "bob" }, IP)).rejects.toBeInstanceOf(AuthError);
    expect(await feedUnlocked("f", undefined, "ann")).toBe("unlocked");
    expect(await feedUnlocked("f", undefined, "bob")).toBe("locked");
  });

  test("only the owner may rename or delete an owned feed; a feed without one is anyone's with access", async () => {
    await owned();
    await expect(requireOwnerIfOwned("f", "bob")).rejects.toBeInstanceOf(OwnerOnlyError);
    await expect(requireOwnerIfOwned("f", undefined)).rejects.toBeInstanceOf(OwnerOnlyError);
    await expect(requireOwnerIfOwned("f", "ann")).resolves.toBeUndefined();
    await open("free");
    await expect(requireOwnerIfOwned("free", undefined)).resolves.toBeUndefined();
  });
});

test("a feed made by an account is that account's, one made without none", async () => {
  await open("mine");
  await ownNewFeed("mine", "ann");
  await open("nobodys");
  await ownNewFeed("nobodys", undefined);
  expect(await feedOwner("mine")).toBe("ann");
  expect(await feedOwner("nobodys")).toBeUndefined();
  await createProtected("mine-protected", "a-password", undefined, "ann");
  expect(await feedOwner("mine-protected")).toBe("ann");
});

test("whose a feed is, seen from an account; the owner's guard lets only the owner through", async () => {
  await open("mine");
  await ownNewFeed("mine", "ann");
  await open("nobodys");
  expect(await feedOwnership("mine", "ann")).toBe("yours");
  expect(await feedOwnership("mine", "bob")).toBe("others");
  expect(await feedOwnership("mine", undefined)).toBe("others");
  expect(await feedOwnership("nobodys", "ann")).toBe("unowned");
  await expect(requireOwner("mine", "ann")).resolves.toBeUndefined();
  await expect(requireOwner("mine", "bob")).rejects.toBeInstanceOf(OwnerOnlyError);
  await expect(requireOwner("nobodys", "ann")).rejects.toBeInstanceOf(OwnerOnlyError);
});

test("an account's feeds are listed, sorted; a change shows at once", async () => {
  await open("b");
  await ownNewFeed("b", "ann");
  await open("a");
  await ownNewFeed("a", "ann");
  await open("c");
  await ownNewFeed("c", "bob");
  expect(await ownedFeeds("ann")).toEqual(["a", "b"]);
  await setFeedOwner("c", "ann");
  expect(await ownedFeeds("ann")).toEqual(["a", "b", "c"]);
  await setFeedOwner("a", undefined);
  expect(await ownedFeeds("ann")).toEqual(["b", "c"]);
});

test("the owner is stored with the feed, never as plain text next to it on the file system's .password file only", async () => {
  await open("o");
  await ownNewFeed("o", "ann");
  expect(await storage().readHash("o")).toContain('"owner":"ann"');
});
