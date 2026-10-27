// What a license changes on the SaaS (ADR 0029, issue #42). With no payment provider configured (NOTEFEED_PAYMENT_PROVIDER) none of
// it applies: every feature is open and no free-tier cap is kept, as on a self-hosted instance. With one, a feed without an active
// license is on the free tier: it keeps its newest notes (config.freeNoteCap), and has no images and no new feed password.
// A lapsed license changes nothing already stored: the notes stay, images are still served, and a password keeps protecting the feed.
import { config } from "./config";
import { LicenseRequiredError } from "./errors";
import { isHeldBack } from "./feednames";
import { logger } from "./log";
import { countNotes, idsBeyond, removeNote } from "./notes";
import { paymentProvider, type Plan } from "./payments";
import { processState } from "./state";
import type { LicenseStore } from "./storage/licenses";
import { createLicenseDb, type LicenseDb } from "./storage/licensedb";
import { encryptionKeys, wrapperFromConfig } from "./storage/wrapper";

const log = logger("licensing");

export const licensingOn = (): boolean => config.paymentProvider() !== "";
export const freeNoteCap = config.freeNoteCap;
/** The plans for sale, as the provider holds them (ADR 0035); none without a provider. */
export const licensePlans = async (): Promise<Plan[]> => (await paymentProvider()?.plans()) ?? [];

const state = processState("licenses", () => ({}) as { file?: string; keys?: string; db?: LicenseDb });

/** The license store: a SQLite file of its own (config.licenseDb), apart from the feeds. One per file; processState because Next may bundle this module once per route. */
export function licenses(): LicenseStore {
  const file = config.licenseDb();
  const keys = encryptionKeys();
  if (state.db && state.file === file && state.keys === keys) return state.db;
  void state.db?.close();
  state.file = file;
  state.keys = keys;
  return (state.db = createLicenseDb(file, wrapperFromConfig()));
}

export async function resetLicensesForTests(): Promise<void> {
  await state.db?.close();
  state.db = undefined;
  state.file = undefined;
}

/** The feed is gone (deleted, or taken down): its license is not lost, it is free to be entered on another feed. */
/** Opens the license store at start, when there is one (see LicenseDb.ready). */
export async function openLicenses(): Promise<void> {
  if (licensingOn()) await (licenses() as LicenseDb).ready();
}

export async function releaseLicense(feed: string): Promise<void> {
  if (licensingOn()) await licenses().detach(feed);
}

/** Whether the feed has what a license unlocks: always, with no provider; else an active license attached to it. */
export async function isLicensed(feed: string): Promise<boolean> {
  if (!licensingOn()) return true;
  // The operator's reserved feeds (ADR 0012) are never on the free tier: only the operator posts there (#242).
  if (isHeldBack(feed)) return true;
  return hasActiveLicense(feed);
}

/** Whether a license on the feed is active now, whatever else would make the feed licensed. */
export async function hasActiveLicense(feed: string): Promise<boolean> {
  const license = await licenses().byFeed(feed);
  // A lapsed period counts even if the provider's webhook for it never came.
  return license?.status === "active" && (license.validUntil === null || license.validUntil > Date.now());
}

/** For images and for setting or changing a feed password. Throws LicenseRequiredError. */
export async function requireLicense(feed: string): Promise<void> {
  if (!(await isLicensed(feed))) throw new LicenseRequiredError();
}

/** A free feed's notes against the cap (issue #183), for its owner; null when no cap applies: licensed, or no payment provider. */
export async function freeTier(feed: string): Promise<{ notes: number; cap: number } | null> {
  if (await isLicensed(feed)) return null;
  return { notes: await countNotes(feed, "markdown"), cap: config.freeNoteCap() };
}

/** After a note is stored: a free feed drops its oldest notes past the cap, so a write is never refused. Images are not counted: a free feed has none. */
export async function trimToFreeCap(feed: string): Promise<void> {
  if (await isLicensed(feed)) return;
  const excess = await idsBeyond(feed, config.freeNoteCap(), "markdown");
  for (const id of excess) await removeNote(feed, id, "free_cap");
  if (excess.length) log.info({ dropped: excess.length }, "oldest notes dropped, the feed is on the free tier"); // never the feed's name
}
