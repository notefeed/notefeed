// What the rest of the backend needs from storage, in terms of feeds and notes, not files. Implemented by the file system
// (storage/fs), SQLite and PostgreSQL (storage/sql); backend/storage/contract.ts is the suite every one must pass.
// Names are checked by backend/feeds.ts and backend/notes.ts first; nothing here validates them.

/** `of`: on an attachment, the id of the text note it was posted with. */
export type Meta = { title?: string; sender?: string; tags?: string[]; alt?: string; name?: string; created?: string; of?: string };

// `ownImage`: the title image is the feed's own, uploaded as one (not a post): lists leave that image note out (notes.ts).
export type Settings = { title: string; description: string; image: string; showSender: boolean; ownImage?: boolean };

/** A note as listed: which note, the extension its file has, and its date (ms since the epoch). */
export type NoteRef = { id: string; ext: string; date: number };

/** `content` is empty when `withContent` said no; `size` is right either way. `mtime` is when the content was last written; `date` is
 *  the note's own (ms), which orders the feed. */
export type StoredNote = { ext: string; content: Buffer; size: number; meta: Meta; mtime: Date; date: number };

/** One feed as the operator's metrics count it (ADR 0039): flags and numbers, never its name, read id or anything in it.
 *  `notes`: per extension, how many and their bytes; `lastWrite`: when the newest content was written (ms), null for no notes. */
export type FeedUsage = { protected: boolean; readLink: boolean; lastWrite: number | null; notes: Record<string, { count: number; bytes: number }> };

/** A write into a feed that does not exist (deleted since the caller looked). Callers forget the feed and, once, make it anew. */
export class FeedGoneError extends Error {
  constructor() {
    super("no such feed");
    this.name = "FeedGoneError";
  }
}

export interface Storage {
  // Notes. `exts` are the extensions that count as notes, in the order to try; a missing, unreadable or non-regular entry is "not a note".
  /** Stores `content` under `<base>`, or `<base>-2`, `-3`, … if taken, dated `date` (ms); returns the id used. Never overwrites. Throws FeedGoneError. */
  writeNote(feed: string, base: string, ext: string, content: string | Uint8Array, meta: Meta, date: number): Promise<string>;
  /**
   * The stored notes of the feed, each once, newest first by `(date, id)`; the caller filters by type. An unknown feed lists as empty.
   * `upTo`: only notes dated then or earlier. `before`: only the notes after that one in this order; one that is not in the list (gone,
   * or past `upTo`) gives none. `limit`: at most that many.
   * A note stored before notes had a date has the metadata's `created`, else its mtime (file system), or 0 (SQL).
   */
  listNoteRefs(feed: string, q?: { upTo?: number; before?: string; limit?: number }): Promise<NoteRef[]>;
  readNote(feed: string, id: string, exts: readonly string[], withContent: (ext: string) => boolean): Promise<StoredNote | null>;
  readMeta(feed: string, ref: Pick<NoteRef, "id" | "ext">): Promise<Meta | null>;
  replaceNote(feed: string, id: string, exts: readonly string[], content: string | Uint8Array): Promise<boolean>;
  /** A string or list sets a field, null (or an empty value) removes it. False when there is no such note. */
  updateMeta(feed: string, id: string, exts: readonly string[], patch: { [K in keyof Meta]?: Meta[K] | null }): Promise<boolean>;
  /** Gives the note a new date (ms); content and metadata stay. False when there is no such note. */
  setDate(feed: string, id: string, exts: readonly string[], date: number): Promise<boolean>;
  /** Moves the note `<id>.<ext>` to `newId`; content, metadata, date and size stay. False when there is no such note or `newId` is taken. */
  renameNote(feed: string, id: string, ext: string, newId: string): Promise<boolean>;
  deleteNote(feed: string, id: string, exts: readonly string[]): Promise<boolean>;
  /** The bytes of a note's file by its name (`<id>.<ext>`), for /r/<read id>/<file>; null for anything else. */
  readFile(feed: string, name: string): Promise<Buffer | null>;

  // The feed's own values. Reads of a missing feed give the empty value.
  readSettings(feed: string): Promise<Settings>;
  writeSettings(feed: string, s: Settings): Promise<void>; // FeedGoneError
  readHash(feed: string): Promise<string | null>;
  writeHash(feed: string, hash: string): Promise<void>; // FeedGoneError
  removeHash(feed: string): Promise<void>;

  // Feeds.
  /** Makes the feed under `readId`, protected from the start when `hash` is given. `created: false`: it exists. Throws ReadIdTakenError. */
  createFeed(feed: string, readId: string, hash?: string): Promise<{ created: boolean }>;
  /** The feed with everything in it. False when there is no such feed. */
  deleteFeed(feed: string): Promise<boolean>;
  /** For a writer that found a listed feed gone: drops what is left of its entry, unless the feed was made anew (`readId` says which).
   *  Only the file system has such leftovers; a database backend does nothing, its rows are the truth and are never dropped here. */
  forgetFeed(feed: string, readId: string | null): Promise<void>;
  /** Throws NotFoundError (no such feed) or ReadIdTakenError. */
  setReadId(feed: string, readId: string): Promise<void>;
  /** undefined: no such feed. null: a feed without a read link. */
  feedReadId(feed: string): Promise<string | null | undefined>;
  feedForReadId(readId: string): Promise<string | null>;
  listFeeds(): Promise<string[]>;
  /** Whether the migration to opaque ids (backend/notemigration.ts) still has to run: notes are stored and no pass of it has completed
   *  (`markMigrated`). Needs no key, so it is answered while the key service is down. */
  migrationPending(): Promise<boolean>;
  /** Records that a pass of the migration completed, for good: from then on migrationPending is false. Needs no key either. */
  markMigrated(): Promise<void>;
  /** Every stored feed name, valid or not, for the start-up warning about names that collide with routes. */
  listFeedNames(): Promise<string[]>;
  feedCount(): Promise<number>;
  /** Every feed, once, for the operator's metrics; no content is read. Costs a pass over all notes: the caller caches it. */
  usage(): Promise<FeedUsage[]>;

  // The operator's takedown (issue #155). A tombstone holds a feed's name and its read id for good: createFeed refuses the name
  // (RemovedFeedError) and the id (ReadIdTakenError), setReadId the id. The blocklist holds the hashes (SHA-256, hex) of images that
  // may not come back; the check is the caller's (backend/posting.ts). Both are part of the data, so a backup restores them.
  /** Records the tombstone first (the feed stops being found by either identifier), then removes the feed with everything in it.
   *  `removed` false: there was no such feed; the tombstone is recorded all the same. `keys`: the image store objects removed, for the operator's purge. */
  takedownFeed(feed: string, readId: string | null): Promise<{ removed: boolean; keys: string[] }>;
  isRemoved(q: { feed?: string; readId?: string }): Promise<boolean>;
  blockImages(hashes: string[]): Promise<void>;
  isBlockedImage(hash: string): Promise<boolean>;
}
