// A feed's passwords and its owner (feedrecord.ts, ADR 0059). A feed without an owner has at most one password, set when it is created
// or later by whoever has access to the open feed (changePassword, ADR 0044). An owned feed has as many named passwords as its owner
// gives it, each revocable on its own, and only the owner manages them, renames and deletes the feed. Any of the passwords opens it;
// so does the owner's own account. Unprotected feeds pass every check. The record is read per request, so a change takes effect at once.
import { createHmac, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { promisify } from "node:util";
import { processState } from "./state";
import { PASSWORD_PATTERN, PASSWORD_RULE } from "../shared/password";
import { storage } from "./storage";
import { FeedGoneError } from "./storage/types";
import {
  AuthError,
  FeedExistsError,
  FeedOwnedError,
  InvalidBodyError,
  NotFoundError,
  OwnerOnlyError,
  TooManyAttemptsError,
  LicenseRequiredError,
} from "./errors";
import { type FeedPassword, type FeedRecord, isProtected, LEGACY_ID, LEGACY_NAME, parseRecord, serializeRecord } from "./feedrecord";
import { cleanLine } from "../shared/links";
import { checkFeed, createProtectedFeed, hasFeed, secret } from "./feeds";
import { authAttempt } from "./limits";
import { licensingOn, requireLicense } from "./licensing";

// An empty password means none, wherever it comes from (header, body field, MCP argument). `account`: the signed-in account behind the
// request, if any (a session from this instance's own pages; later an account token): the owner's passes without a password.
export type FeedAccess = { password?: string; cookie?: string; account?: string };

export const feedCookieName = (feed: string) => `nf_feed_${feed}`;

const PASSWORD_RE = new RegExp(`^(?:${PASSWORD_PATTERN})$`);

export function checkNewPassword(p: string): void {
  if (!PASSWORD_RE.test(p)) throw new InvalidBodyError(`password must be ${PASSWORD_RULE}`);
}

const N = 16384,
  R = 8,
  P = 1,
  KEYLEN = 64;
// The async scrypt runs on the thread pool: a password check (some 40 ms) must not stall every other request.
const scryptAsync = promisify<string, Buffer, number, ScryptOptions, Buffer>(scrypt);
const derive = (p: string, salt: Buffer, n: number, r: number, pp: number, len: number) =>
  scryptAsync(p, salt, len, { N: n, r, p: pp, maxmem: 128 * n * r * 2 });

// scrypt$N$r$p$salt$hash (base64), so the parameters can change later without breaking stored hashes.
export async function hashPassword(p: string): Promise<string> {
  const salt = randomBytes(16);
  return ["scrypt", N, R, P, salt.toString("base64"), (await derive(p, salt, N, R, P, KEYLEN)).toString("base64")].join("$");
}

export async function verifyHash(p: string, hash: string): Promise<boolean> {
  const [tag, n, r, pp, salt, key] = hash.split("$");
  if (tag !== "scrypt" || !key) return false;
  try {
    const want = Buffer.from(key, "base64");
    const got = await derive(p, Buffer.from(salt, "base64"), +n, +r, +pp, want.length);
    return want.length > 0 && timingSafeEqual(got, want);
  } catch {
    return false; // malformed or absurd parameters
  }
}

// The feed's record, or null for an open feed without an owner.
export const feedRecord = async (feed: string): Promise<FeedRecord | null> => parseRecord(await storage().readHash(feed));

async function writeRecord(feed: string, rec: FeedRecord): Promise<void> {
  const raw = serializeRecord(rec);
  try {
    if (raw === null) await storage().removeHash(feed);
    else await storage().writeHash(feed, raw);
  } catch (e) {
    if (e instanceof FeedGoneError) throw new NotFoundError("no such feed"); // deleted meanwhile
    throw e;
  }
  ownersChanged();
}

export const protectedFeed = async (feed: string): Promise<boolean> => isProtected(await feedRecord(feed));

// The account that owns the feed, or undefined.
export const feedOwner = async (feed: string): Promise<string | undefined> => (await feedRecord(feed))?.owner;

// Whose a feed is, seen from `account` (ADR 0059): nobody's, the account's own, or someone else's. Every owner check asks this.
export type Ownership = "unowned" | "yours" | "others";
const ownershipOf = (rec: FeedRecord | null, account: string | undefined): Ownership => (!rec?.owner ? "unowned" : rec.owner === account ? "yours" : "others");
export const feedOwnership = async (feed: string, account: string | undefined): Promise<Ownership> => ownershipOf(await feedRecord(feed), account);

const cookieOf = (feed: string, hash: string) =>
  createHmac("sha256", secret())
    .update(feed + hash)
    .digest("hex");

// The unlock cookie for the feed's first password: what a browser gets after creating a protected feed.
export async function cookieValue(feed: string): Promise<string | null> {
  const first = (await feedRecord(feed))?.entries[0];
  return first ? cookieOf(feed, first.hash) : null;
}

// The only comparison of an unlock cookie: one per password, so revoking a password ends the cookies made with it.
function cookieUnlocks(feed: string, rec: FeedRecord, cookie: string | undefined): boolean {
  const got = Buffer.from(cookie ?? "");
  let ok = false;
  for (const p of rec.entries) {
    const want = Buffer.from(cookieOf(feed, p.hash));
    if (got.length === want.length && timingSafeEqual(got, want)) ok = true;
  }
  return ok;
}

// No password at all is refused first: no scrypt, and nothing counted, or anyone could lock the owner out
// just by asking. Only a wrong password is a failed attempt; over the limit it is not even compared.
// The attempt is counted before the hashing and given back if the password was right: counted afterwards,
// every guess of a concurrent burst would get past the limit while the first ones are still hashing.
// Returns the password that matched.
async function matchEntry(password: string | undefined, rec: FeedRecord, ip: string): Promise<FeedPassword> {
  if (!password) throw new AuthError();
  const attempt = authAttempt(ip);
  if (typeof attempt === "number") throw new TooManyAttemptsError(attempt);
  for (const p of rec.entries)
    if (await verifyHash(password, p.hash)) {
      attempt();
      return p;
    }
  throw new AuthError();
}

const ownedBy = (rec: FeedRecord | null, account: string | undefined): boolean => ownershipOf(rec, account) === "yours";

// Passes for a feed without a password. True when the feed has one and this access proved it (a password, its cookie, or the owner's
// account); a bad or stale cookie with no password beside it is, like no password, not a failed attempt.
export async function checkFeedAccess(feed: string, access: FeedAccess, ip: string): Promise<boolean> {
  const rec = await feedRecord(feed);
  if (!isProtected(rec)) return ownedBy(rec, access.account);
  if (ownedBy(rec, access.account)) return true;
  if (!cookieUnlocks(feed, rec!, access.cookie)) await matchEntry(access.password, rec!, ip);
  return true;
}

/** For the pages. open: the feed has no password; unlocked: the cookie is a valid one, or the owner is signed in; locked: anything
 *  else. Counts no attempts. */
export async function feedUnlocked(feed: string, cookie: string | undefined, account?: string): Promise<"open" | "unlocked" | "locked"> {
  if (checkFeed(feed)) return "open"; // the page 404s on its own
  const rec = await feedRecord(feed);
  if (!isProtected(rec)) return "open";
  return ownedBy(rec, account) || cookieUnlocks(feed, rec!, cookie) ? "unlocked" : "locked";
}

export async function unlock(feed: string, password: string, ip: string): Promise<string> {
  const rec = await feedRecord(feed);
  if (!isProtected(rec)) throw new AuthError();
  return cookieOf(feed, (await matchEntry(password, rec!, ip)).hash);
}

export async function createProtected(feed: string, password: string, readId?: string, account?: string): Promise<void> {
  checkNewPassword(password);
  const hash = await hashPassword(password);
  if (await createProtectedFeed(feed, hash, readId)) {
    if (account) await writeRecord(feed, { owner: account, entries: [{ id: LEGACY_ID, name: LEGACY_NAME, hash, created: Date.now() }] });
    return;
  }
  throw (await protectedFeed(feed)) ? new AuthError() : new FeedExistsError();
}

// A feed that was just created by `account` becomes its own (ADR 0059); nothing for one made without an account.
export async function ownNewFeed(feed: string, account: string | undefined): Promise<void> {
  if (!account) return;
  const rec = (await feedRecord(feed)) ?? { entries: [] };
  if (!rec.owner) await writeRecord(feed, { ...rec, owner: account });
}

// Changing the single password is for a feed without an owner: an owned feed's passwords are its owner's (addFeedPassword).
function refuseOwned(rec: FeedRecord | null): void {
  if (rec?.owner) throw new OwnerOnlyError("an owned feed's passwords are managed by its owner");
}

// Sets the feed's password, or changes it; returns the unlock cookie for the new one, and every earlier cookie stops working. A
// protected feed needs the current password. An open feed takes one from whoever has access to it, which is whoever knows its
// name: the name is all that protects an open feed, and setting a password claims it (ADR 0044).
export async function changePassword(feed: string, current: string, next: string, ip: string): Promise<string> {
  checkNewPassword(next);
  const rec = await feedRecord(feed);
  if (rec === null && !(await hasFeed(feed))) throw new NotFoundError("no such feed");
  refuseOwned(rec);
  await requireLicense(feed); // setting or changing a password is for licensed feeds; removing one is not (ADR 0029)
  if (isProtected(rec)) await matchEntry(current, rec!, ip);
  return writeNewHash(feed, next);
}

export async function removePassword(feed: string, current: string, ip: string): Promise<void> {
  const rec = await feedRecord(feed);
  if (!isProtected(rec)) throw new FeedExistsError();
  refuseOwned(rec);
  await matchEntry(current, rec!, ip);
  await writeRecord(feed, { entries: [] });
}

async function writeNewHash(feed: string, next: string): Promise<string> {
  const hash = await hashPassword(next);
  // ponytail: checked, not locked. The write is by path after the scrypt wait, so a feed deleted and re-created meanwhile (same
  // name) gets this password; a per-feed lock would close it.
  await writeRecord(feed, { entries: [{ id: LEGACY_ID, name: LEGACY_NAME, hash, created: Date.now() }] });
  return cookieOf(feed, hash);
}

// ---- Owners (ADR 0059) ----

// The owner's own steps: refused for anyone else, including a holder of a feed password. A feed without an owner has none, so
// these are refused there too.
async function ownersRecord(feed: string, account: string | undefined): Promise<FeedRecord> {
  const rec = await feedRecord(feed);
  if (rec === null && !(await hasFeed(feed))) throw new NotFoundError("no such feed");
  if (!ownedBy(rec, account)) throw new OwnerOnlyError();
  return rec!;
}

// Whoever may delete or rename the feed: on an owned feed only its owner, on any other whoever has access (checked by the caller).
export async function requireOwnerIfOwned(feed: string, account: string | undefined): Promise<void> {
  if ((await feedOwnership(feed, account)) === "others") throw new OwnerOnlyError();
}

// The owner's own steps on a feed that has one: refused for anyone else, and on a feed without an owner.
export async function requireOwner(feed: string, account: string | undefined): Promise<void> {
  if ((await feedOwnership(feed, account)) !== "yours") throw new OwnerOnlyError();
}

// Claims the feed for `account`: a protected feed with one of its passwords (it becomes the first of the owner's, named
// "Feed password", so scripts keep working), an open one by giving it a password (`password`, as ADR 0044 protects one). An owned
// feed can't be claimed, also not by a feed password holder or after its owner's account is gone. Returns the unlock cookie.
export async function claimFeed(feed: string, account: string, password: string, ip: string): Promise<string> {
  const rec = await feedRecord(feed);
  if (rec === null && !(await hasFeed(feed))) throw new NotFoundError("no such feed");
  if (rec?.owner) throw new FeedOwnedError();
  if (isProtected(rec)) {
    const matched = await matchEntry(password, rec!, ip);
    await writeRecord(feed, { owner: account, entries: rec!.entries });
    return cookieOf(feed, matched.hash);
  }
  checkNewPassword(password);
  // A password needs the license (ADR 0029), and an open feed has none until it is owned: where licenses are sold, claiming it takes
  // a free unit of the account's license and puts it there, as creating a protected feed does (ADR 0061).
  let covered: number | undefined;
  if (licensingOn()) {
    await requireFreeUnit(account);
    covered = Date.now();
  }
  const hash = await hashPassword(password);
  await writeRecord(feed, { owner: account, entries: [{ id: LEGACY_ID, name: LEGACY_NAME, hash, created: Date.now() }], ...(covered ? { covered } : {}) });
  return cookieOf(feed, hash);
}

export const MAX_PASSWORD_NAME = 50;
function checkPasswordName(name: string): string {
  const clean = cleanLine(name);
  if (!clean || clean !== name.trim() || [...clean].length > MAX_PASSWORD_NAME)
    throw new InvalidBodyError(`name must be one line of 1 to ${MAX_PASSWORD_NAME} characters`);
  return clean;
}

// A generated feed password: 24 characters of a URL-safe alphabet, 144 bits. Shown once.
const newSecret = () => randomBytes(18).toString("base64url");

export type FeedPasswordInfo = { id: string; name: string; created: string | null };
const info = (p: FeedPassword): FeedPasswordInfo => ({ id: p.id, name: p.name, created: p.created ? new Date(p.created).toISOString() : null });

export const listFeedPasswords = async (feed: string, account: string | undefined): Promise<FeedPasswordInfo[]> =>
  (await ownersRecord(feed, account)).entries.map(info);

// A new named password for the owner's feed, generated: returned once with its id. Protection needs the license (ADR 0029).
export async function addFeedPassword(feed: string, account: string | undefined, name: string): Promise<FeedPasswordInfo & { password: string }> {
  const rec = await ownersRecord(feed, account);
  const clean = checkPasswordName(name);
  await requireLicense(feed);
  const password = newSecret();
  const entry: FeedPassword = { id: randomBytes(9).toString("base64url"), name: clean, hash: await hashPassword(password), created: Date.now() };
  await writeRecord(feed, { ...rec, entries: [...rec.entries, entry] });
  return { ...info(entry), password };
}

// Revokes one of the owner's entries: it, and every cookie made with it, stops working at once. Revoking the last leaves the feed
// open, still the owner's.
export async function revokeFeedPassword(feed: string, account: string | undefined, id: string): Promise<void> {
  const rec = await ownersRecord(feed, account);
  if (!rec.entries.some((p) => p.id === id)) throw new NotFoundError("no such feed password");
  await writeRecord(feed, { ...rec, entries: rec.entries.filter((p) => p.id !== id) });
}

// The operator's (/api/operator/feeds): gives the feed to `account`, or takes its owner away (undefined), whoever owned it, for a feed
// whose owner's account is gone. Its passwords stay.
export async function setFeedOwner(feed: string, account: string | undefined): Promise<void> {
  const rec = await feedRecord(feed);
  if (rec === null && !(await hasFeed(feed))) throw new NotFoundError("no such feed");
  await writeRecord(feed, { ...(rec ?? { entries: [] }), owner: account });
}

// ---- The license on the account (#391, ADR 0061) ----

// The owner's feeds under its license, in the order they were put there (then by name): the license covers the first as many as its
// units, so a lapse or a lower number takes the latest ones off first, and nothing is uncovered by guessing.
export async function coveredFeeds(account: string): Promise<string[]> {
  return (await ownedRecords(account))
    .filter((o): o is { feed: string; covered: number } => o.covered !== undefined)
    .sort((a, b) => a.covered - b.covered || (a.feed < b.feed ? -1 : 1))
    .map((o) => o.feed);
}

// A free unit of the account's license for one more feed, or LicenseRequiredError. `units` when the caller has them already.
export async function requireFreeUnit(account: string, units?: number): Promise<void> {
  units ??= await (await import("./accounts/subscriptions")).activeUnits(account);
  if ((await coveredFeeds(account)).length >= units) throw new LicenseRequiredError("the account's license covers no more feeds: raise its number first");
}

// Puts the owner's feed under its license (or takes it off): refused past the license's units (LicenseRequiredError).
export async function setCovered(feed: string, account: string | undefined, covered: boolean, units: number): Promise<void> {
  const rec = await ownersRecord(feed, account);
  if (covered === (rec.covered !== undefined)) return;
  if (covered) await requireFreeUnit(account!, units);
  await writeRecord(feed, { ...rec, covered: covered ? Date.now() : undefined });
}

// ---- Which feeds an account owns ----
// Found by reading every feed's record (sealed on an encrypted database, so the storage can't be asked): done once, with when each
// was put under the license, then kept for a minute and dropped at every change this process makes. Another process's change shows
// within that minute. Callers meanwhile share one scan, and a scan that a change overtook is used once but not kept.
const OWNERS_TTL = 60_000;
type Owned = { feed: string; covered?: number };
const owners = processState("feed-owners", () => ({
  at: -Infinity,
  gen: 0,
  byAccount: new Map<string, Owned[]>(),
  scan: undefined as Promise<Map<string, Owned[]>> | undefined,
}));
export function ownersChanged(): void {
  owners.at = -Infinity;
  owners.gen++;
  owners.scan = undefined;
}
async function ownedRecords(account: string): Promise<Owned[]> {
  if (Date.now() - owners.at <= OWNERS_TTL) return owners.byAccount.get(account) ?? [];
  const gen = owners.gen;
  const scan = (owners.scan ??= (async () => {
    const byAccount = new Map<string, Owned[]>();
    for (const feed of await storage().listFeeds()) {
      const rec = await feedRecord(feed).catch(() => null);
      if (rec?.owner) byAccount.set(rec.owner, [...(byAccount.get(rec.owner) ?? []), { feed, ...(rec.covered !== undefined ? { covered: rec.covered } : {}) }]);
    }
    return byAccount;
  })());
  const byAccount = await scan;
  if (owners.scan === scan) owners.scan = undefined;
  if (owners.gen === gen) {
    owners.byAccount = byAccount;
    owners.at = Date.now();
  }
  return byAccount.get(account) ?? [];
}
export const ownedFeeds = async (account: string): Promise<string[]> => (await ownedRecords(account)).map((o) => o.feed).sort();
export const resetOwnersForTests = ownersChanged;
