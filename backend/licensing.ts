// What a license changes on the SaaS (ADR 0029, ADR 0061). With no payment provider configured (NOTEFEED_PAYMENT_PROVIDER) none of
// it applies: every feature is open and no free-tier cap is kept, as on a self-hosted instance. With one, a feed its owner's license
// doesn't cover is on the free tier: it keeps its newest notes (config.freeNoteCap), and has no images and no new feed password.
// A license belongs to an account (#391): its subscriptions' units (accounts/subscriptions.ts) say how many of the account's feeds it
// covers, the owner says which (feedlock.ts setCovered), and the first ones covered count when there are more than the units.
// A lapsed license changes nothing already stored: the notes stay, images are still served, and a password keeps protecting the feed.
import { config } from "./config";
import { LicenseRequiredError } from "./errors";
import { isHeldBack } from "./feednames";
import { logger } from "./log";
import { countNotes, idsBeyond, removeNote } from "./notes";
import { paymentProvider, type Plan } from "./payments";

const log = logger("licensing");

export const licensingOn = (): boolean => config.paymentProvider() !== "";
export const freeNoteCap = config.freeNoteCap;
/** The plans sold, from the payment provider; none with no provider. */
export const licensePlans = async (): Promise<Plan[]> => (await paymentProvider()?.plans()) ?? [];

/** The feeds of `account` its license covers now: its covered feeds, as many as its active units, oldest cover first. */
export async function licensedFeedsOf(account: string): Promise<string[]> {
  const { coveredFeeds } = await import("./feedlock"); // feedlock imports this file
  const { activeUnits } = await import("./accounts/subscriptions");
  const units = await activeUnits(account);
  return units > 0 ? (await coveredFeeds(account)).slice(0, units) : [];
}

/** Whether the feed has what a license unlocks: always, with no provider; else when its owner's license covers it. */
export async function isLicensed(feed: string): Promise<boolean> {
  if (!licensingOn()) return true;
  // The operator's reserved feeds (ADR 0012) are never on the free tier: only the operator posts there (#242).
  if (isHeldBack(feed)) return true;
  const { feedRecord } = await import("./feedlock");
  const rec = await feedRecord(feed);
  if (!rec?.owner || rec.covered === undefined) return false;
  return (await licensedFeedsOf(rec.owner)).includes(feed);
}

/** For images and for setting a feed password. Throws LicenseRequiredError. */
export async function requireLicense(feed: string): Promise<void> {
  if (!(await isLicensed(feed))) throw new LicenseRequiredError();
}

/** A free feed's notes against the cap (issue #183), for its owner; null when no cap applies: licensed, or no payment provider. Every
 *  note counts: a text, an image (one kept from a license that lapsed) and the operator's mark (#159). */
export async function freeTier(feed: string): Promise<{ notes: number; cap: number } | null> {
  if (await isLicensed(feed)) return null;
  return { notes: await countNotes(feed), cap: config.freeNoteCap() };
}

/** After a note is stored: a free feed drops its oldest notes past the cap, of any kind, so a write is never refused. */
export async function trimToFreeCap(feed: string): Promise<void> {
  if (await isLicensed(feed)) return;
  const excess = await idsBeyond(feed, config.freeNoteCap());
  for (const id of excess) await removeNote(feed, id, "free_cap");
  if (excess.length) log.info({ dropped: excess.length }, "oldest notes dropped, the feed is on the free tier"); // never the feed's name
}
