// Uploads (#381, ADR 0064): a file sent on its own, to a short-lived URL, and posted afterwards by its id. An assistant's tool call
// is JSON the model writes, so a picture as base64 costs every byte as output; with an upload, a shell sends the bytes (curl -T)
// and the model only writes the id.
//
// An upload is made for one feed, with the feed's access (as a post), and its type fixed. Its URL carries only a random token: no
// feed name, password or license key. The URL takes one PUT of the raw bytes; the file then waits in the data directory until a
// post uses it (and it is deleted) or it expires. The list of uploads is kept in memory: a restart forgets them, and the first
// upload afterwards clears what is left on disk.
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config";
import { ImageTooLargeError, InvalidBodyError, InvalidRequestError, NoteTooLargeError, NotFoundError, RateLimitedError, UnsupportedTypeError } from "./errors";
import { MAX_ATTACHMENTS } from "../shared/links";
import { MAX_BYTES } from "./note/markdown";
import { parseMediaType } from "./note/types";
import { logger } from "./log";
import { processState } from "./state";

export const UPLOAD_TTL_MS = 15 * 60_000;
// At most this many uploads wait for one feed, and for one sender (a post's pictures fit). The sender is an account, a feed's
// password or, for anyone else, an address (posting.ts, createUpload); only its hash is kept, in memory and gone with the upload.
export const MAX_UPLOADS_PER_FEED = MAX_ATTACHMENTS;
// At most this many files wait on disk, checked when a file is sent: an upload without its file costs no disk, so only a sender who
// sends real files can take these places.
export const MAX_UPLOAD_FILES = 32;
// The list in memory, so many senders together can't grow it without end.
export const MAX_UPLOADS = 1000;

type Upload = {
  feed: string;
  sender: string; // a hash of who made it: an account, a feed password or an address
  mediaType: string;
  isImage: boolean;
  maxBytes: number;
  size?: number; // as announced when it was made: the PUT must match
  expires: number;
  tokenHash: string;
  // waiting: no file yet; receiving: a PUT is reading it; received: the file is there; using: a post is reading it.
  state: "waiting" | "receiving" | "received" | "using";
};

const log = logger("uploads");
const uploads = processState("uploads", () => ({ byId: new Map<string, Upload>(), cleared: new Map<string, Promise<void>>() }));
// A dot first: a feed's name can't start with one, and the file system storage keeps each feed in a folder of the data directory.
const dir = () => join(config.dataDir(), ".uploads");
const fileOf = (id: string) => join(dir(), id);
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const ID_RE = /^[0-9a-f]{32}$/;

// Once per process, before the first file is written: whatever is on disk is from before a restart, which forgot its uploads.
// Keyed by the directory, which tests change.
// A failed attempt is forgotten, so the next upload tries again.
function ready(): Promise<void> {
  const d = dir();
  let p = uploads.cleared.get(d);
  if (!p) {
    p = rm(d, { recursive: true, force: true })
      .then(() => mkdir(d, { recursive: true }))
      .then(() => undefined);
    p.catch(() => uploads.cleared.delete(d));
    uploads.cleared.set(d, p);
  }
  return p;
}

// Expired uploads go, with their files; one a post is reading stays until that post is done. One a PUT is still reading goes too:
// a body that never ends keeps no place, and the PUT finds its upload gone.
async function sweep(now: number): Promise<void> {
  const gone = [...uploads.byId].filter(([, u]) => u.expires <= now && u.state !== "using").map(([id]) => id);
  for (const id of gone) uploads.byId.delete(id);
  await Promise.all(gone.map((id) => rm(fileOf(id), { force: true })));
}

// The largest file an upload (or a fetched file, posting.ts) of this type takes: a picture's limit, or a text note's.
export const limitOf = (isImage: boolean) => (isImage ? config.maxImageBytes() : MAX_BYTES);
const tooLarge = (isImage: boolean) => (isImage ? new ImageTooLargeError() : new NoteTooLargeError());

/** The type an upload is made for: an accepted media type. Checked before anything else, so admission (posting.ts) can depend on it. */
export function uploadType(type: string): { mediaType: string; isImage: boolean } {
  const parsed = parseMediaType(type);
  if (!parsed) throw new UnsupportedTypeError();
  return { mediaType: parsed.mediaType, isImage: parsed.type.name === "image" };
}

export type NewUpload = { id: string; token: string; expires: Date; maxBytes: number };

/** Makes an upload for `feed`, asked for by `senderKey`; the caller has admitted it (posting.ts, createUpload). `size`, when given,
 *  is what the PUT must send. */
export async function makeUpload(
  feed: string,
  senderKey: string,
  type: { mediaType: string; isImage: boolean },
  size?: number,
  now = Date.now(),
): Promise<NewUpload> {
  const maxBytes = limitOf(type.isImage);
  if (size !== undefined && (!Number.isSafeInteger(size) || size < 1)) throw new InvalidRequestError("size must be the file's size in bytes, at least 1");
  if (size !== undefined && size > maxBytes) throw tooLarge(type.isImage);
  await ready();
  await sweep(now);
  const all = [...uploads.byId.values()];
  const sender = hash(`sender:${senderKey}`);
  if (
    all.length >= MAX_UPLOADS ||
    all.filter((u) => u.feed === feed).length >= MAX_UPLOADS_PER_FEED ||
    all.filter((u) => u.sender === sender).length >= MAX_UPLOADS_PER_FEED
  )
    throw tooMany();
  const id = randomBytes(16).toString("hex");
  const token = randomBytes(32).toString("base64url");
  const expires = now + UPLOAD_TTL_MS;
  uploads.byId.set(id, { feed, sender, ...type, maxBytes, size, expires, tokenHash: hash(token), state: "waiting" });
  return { id, token, expires: new Date(expires), maxBytes };
}

const tooMany = () => new RateLimitedError(60, "rate_limited", "too many uploads waiting: post the ones made, or wait until they expire");
const hasFile = (u: Upload) => u.state === "received" || u.state === "using";

const NO_UPLOAD = "no such upload: it expired, was used, or never existed; make a new one";
const findByToken = (token: string): [string, Upload] | undefined => {
  const h = hash(token);
  return [...uploads.byId].find(([, u]) => u.tokenHash === h);
};

/** The PUT to an upload's URL: `read` gives the body, at most `max` bytes (null when it is larger). Once only: a second PUT is refused. */
export async function receiveUpload(
  token: string,
  read: (max: number) => Promise<Uint8Array | null>,
  now = Date.now(),
): Promise<{ size: number; mediaType: string }> {
  await sweep(now);
  const found = findByToken(token);
  if (!found || found[1].expires <= now) throw new NotFoundError(NO_UPLOAD);
  const [id, u] = found;
  if (u.state === "receiving") throw new InvalidRequestError("a file is being sent to this upload right now: wait for that request's answer");
  if (u.state !== "waiting") throw new InvalidRequestError("this upload already has its file: post it by its id, or make a new upload");
  if ([...uploads.byId.values()].filter(hasFile).length >= MAX_UPLOAD_FILES) throw tooMany();
  u.state = "receiving";
  const gone = () => uploads.byId.get(id) !== u; // it expired while the body was read
  try {
    const body = await read(u.maxBytes);
    if (body === null) throw tooLarge(u.isImage);
    if (!body.length) throw new InvalidBodyError("the body is empty: send the file's bytes");
    if (u.size !== undefined && body.length !== u.size) throw new InvalidBodyError(`the upload was made for ${u.size} bytes, not ${body.length}`);
    // The cheap check now, so curl hears of a wrong file at once; the post runs every other check.
    const parsed = parseMediaType(u.mediaType)!;
    if (!parsed.type.verify(body, parsed.ext)) throw new UnsupportedTypeError(`the file is not ${u.mediaType}`);
    if (gone()) throw new NotFoundError(NO_UPLOAD);
    await ready();
    await writeFile(fileOf(id), body);
    if (gone()) {
      await rm(fileOf(id), { force: true });
      throw new NotFoundError(NO_UPLOAD);
    }
    u.state = "received";
    return { size: body.length, mediaType: u.mediaType };
  } catch (e) {
    u.state = "waiting"; // a refused PUT may be sent again, with the right file
    throw e;
  }
}

export type UploadedFile = { id: string; body: Uint8Array; mediaType: string; isImage: boolean };

/** Runs `post` with the files of these uploads of `feed`, and deletes them when it succeeds; a refused post leaves them for another try.
 *  One post at a time per upload, so a file is posted once. */
export async function withUploads<T>(feed: string, ids: readonly string[], post: (files: UploadedFile[]) => Promise<T>, now = Date.now()): Promise<T> {
  if (new Set(ids).size !== ids.length) throw new InvalidRequestError("an upload can only be posted once: the same upload_id is given twice");
  await sweep(now);
  const taken: Upload[] = [];
  let result: T;
  try {
    const found = ids.map((id) => {
      const u = ID_RE.test(id) ? uploads.byId.get(id) : undefined;
      // Another feed's upload is no upload here: not even whether it exists is told.
      if (!u || u.feed !== feed || u.expires <= now) throw new NotFoundError(NO_UPLOAD);
      if (u.state === "waiting" || u.state === "receiving")
        throw new InvalidRequestError(`upload ${id} has no file yet: send it to its upload_url first (curl -T <file> <upload_url>)`);
      if (u.state === "using") throw new InvalidRequestError(`upload ${id} is being posted by another call`);
      return [id, u] as const;
    });
    for (const [, u] of found) {
      u.state = "using";
      taken.push(u);
    }
    const files = await Promise.all(
      found.map(async ([id, u]) => ({ id, body: new Uint8Array(await readFile(fileOf(id))), mediaType: u.mediaType, isImage: u.isImage })),
    );
    result = await post(files);
  } catch (e) {
    for (const u of taken) u.state = "received";
    throw e;
  }
  // Posted: the uploads are used up whatever happens to their files. A file that can't be deleted is no reason to report the post
  // as failed (it would be posted twice); the next restart clears the folder.
  for (const id of ids) uploads.byId.delete(id);
  await Promise.all(ids.map((id) => rm(fileOf(id), { force: true }).catch((e) => log.warn({ err: e }, "an upload's file was not deleted"))));
  return result;
}

/** For tests: forget every upload. */
export function resetUploads(): void {
  uploads.byId.clear();
  uploads.cleared.clear();
}
