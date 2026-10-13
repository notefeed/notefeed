// What a license changes on the SaaS (ADR 0029, issue #42). With no payment provider configured (NOTEFEED_PAYMENT_PROVIDER) none of
// it applies: every feature is open and no free-tier cap is kept, as on a self-hosted instance. With one, a feed without an active
// license is on the free tier: it keeps its newest notes (config.freeNoteCap), and has no images and no new feed password.
// A lapsed license changes nothing already stored: the notes stay, images are still served, and a password keeps protecting the feed.
import { config } from "./config";
import { LicenseRequiredError } from "./errors";
import { logger } from "./log";
import { idsBeyond, removeNote } from "./notes";
import { storage } from "./storage";
import type { LicenseStore } from "./storage/licenses";

const log = logger("licensing");

export const licensingOn = (): boolean => config.paymentProvider() !== "";

/** The license store; only the database backends have one, and config.validateStorage refuses a provider without such a backend. */
export function licenses(): LicenseStore {
  const s = storage();
  if (!("licenses" in s)) throw new Error("licenses need a database backend");
  return s.licenses as LicenseStore;
}

/** Whether the feed has what a license unlocks: always, with no provider; else an active license attached to it. */
export async function isLicensed(feed: string): Promise<boolean> {
  if (!licensingOn()) return true;
  const license = await licenses().byFeed(feed);
  // A lapsed period counts even if the provider's webhook for it never came.
  return license?.status === "active" && (license.validUntil === null || license.validUntil > Date.now());
}

/** For images and for setting or changing a feed password. Throws LicenseRequiredError. */
export async function requireLicense(feed: string): Promise<void> {
  if (!(await isLicensed(feed))) throw new LicenseRequiredError();
}

/** After a note is stored: a free feed drops its oldest notes past the cap, so a write is never refused. Images are not counted: a free feed has none. */
export async function trimToFreeCap(feed: string): Promise<void> {
  if (await isLicensed(feed)) return;
  const excess = await idsBeyond(feed, config.freeNoteCap(), "markdown");
  for (const id of excess) await removeNote(feed, id);
  if (excess.length) log.info({ dropped: excess.length }, "oldest notes dropped, the feed is on the free tier"); // never the feed's name
}
