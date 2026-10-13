// The licenses of the SaaS (ADR 0029, issue #42): one paid license per feed. They live in a SQLite file of their own
// (NOTEFEED_LICENSE_DB), apart from the feeds and notes on whatever storage backend the instance uses, so the two are backed up, restored
// and replaced on their own, and billing records are not in the database that holds the content. The feed is a name here, not a
// reference: the caller checks that it exists, and removes the link when the feed goes (backend/licensing.ts).
// A license is found by the hash of its key (the key itself is never stored), by its feed, or by the provider's reference.

export type LicenseStatus = "active" | "lapsed";

export type License = {
  id: string;
  /** The feed it is attached to; null while it is not (bought, not yet entered, or detached). */
  feed: string | null;
  status: LicenseStatus;
  /** The provider's subscription id, which is how a webhook finds the license. */
  providerRef: string | null;
  /** When the paid period ends, in ms since the epoch; null when the provider gave no date. */
  validUntil: number | null;
};

export type AttachResult = "attached" | "unknown-key" | "feed-has-license";

export interface LicenseStore {
  /** A new license, not attached. `providerRef` is unique: a second license with the same one is the first (a webhook delivered twice). */
  createLicense(o: { keyHash: string; providerRef: string | null; validUntil: number | null }): Promise<License>;
  byKeyHash(keyHash: string): Promise<License | null>;
  byFeed(feed: string): Promise<License | null>;
  byProviderRef(providerRef: string): Promise<License | null>;
  /** Puts the license on `feed`, taking it off the feed it was on, in one statement. */
  attach(keyHash: string, feed: string): Promise<AttachResult>;
  /** Takes the license off the feed. False when the feed had none. */
  detach(feed: string): Promise<boolean>;
  /** The webhook's changes. False when no license has this reference. */
  update(providerRef: string, patch: { status?: LicenseStatus; validUntil?: number | null }): Promise<boolean>;
}
