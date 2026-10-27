// The one way a note gets posted, edited or deleted, for the HTTP API, MCP and the web UI alike. Credentials are the
// caller's job (bearer vs. session cookie); everything after that is here, in this order.
import { config } from "./config";
import { applyImages, type ImagePlan } from "../shared/imagePlan.mjs";
import { isAttachmentName, MAX_ATTACHMENTS, safeName } from "../shared/links";
import { AuthError, BlockedImageError, FeedExistsError, FeedLimitError, ImageLimitError, ImagesOffError, ImageTooLargeError, InvalidBodyError, NotefeedError, NoteLimitError, NotFoundError, LicenseRequiredError, RateLimitedError, RemovedFeedError, ReservedFeedError, UnsupportedTypeError } from "./errors";
import { type FeedAccess, checkFeedAccess, checkNewPassword, createProtected } from "./feedlock";
import { type FeedSettings, checkSettings, getStoredSettings, saveSettings } from "./feedsettings";
import { assertFeed, createOpenFeed, deleteFeed as removeWholeFeed, feedCount, hasFeed, isHeldBack, isRemovedFeed, readIdOf, setReadId } from "./feeds";
import { attachLicense, checkLicenseKey, countingKeys, detachLicense } from "./licenseflow";
import { hasActiveLicense, licensingOn, releaseLicense, requireLicense, trimToFreeCap } from "./licensing";
import { isBlockedImage } from "./takedown";
import { capReached, rateLimit } from "./limits";
import { logger } from "./log";
import { MEDIA_TYPES } from "./note/media";
import { planInWorker } from "./place";
import { type NoteType, parseMediaType } from "./note/types";
import { checkTags } from "./tags";
import { changeDate, checkLine, checkMarkdown, countNotes, createNoteOf, encoder, getNote, MARKDOWN, hasImageNote, MAX_ALT, MAX_NOTE_TITLE, newNoteId, removeNote, replaceContent, changeMeta, type NewNoteOptions, type Note } from "./notes";

const log = logger("posting");

// The gate every write passes first: the feed's access, then the rate limit (counted once per request). Whether the
// password was proved. Writes to a feed with an active license don't count against the per-IP limit (ADR 0046, #123): a paid
// feed's CI bursts never get a 429 from it; wrong passwords and keys still count in their own bucket, checked before this. An edit or delete targets an existing note, so its feed already exists, and the feed's
// protection can only be changed by a request that proved the password: no second access check after `read()`, unlike a post.
async function admit(feed: string, ip: string, access: FeedAccess): Promise<boolean> {
  assertFeed(feed);
  if (await isRemovedFeed(feed)) throw new RemovedFeedError(); // the operator took the name out of use (issue #155): before any password is looked at
  const proved = await checkFeedAccess(feed, access, ip);
  if (licensingOn() && (await hasActiveLicense(feed))) return proved;
  const wait = rateLimit(ip);
  if (wait !== null) throw new RateLimitedError(wait);
  return proved;
}

// An image the operator removed may not come back, in any feed (issue #155).
async function refuseBlocked(body: Uint8Array): Promise<void> {
  if (await isBlockedImage(body)) throw new BlockedImageError();
}

// NOTEFEED_MAX_FEEDS, for a post that would create the feed. Whether the feed exists.
// ponytail: caps are checked, not locked; concurrent posts can overshoot by a few.
async function feedCapped(feed: string): Promise<boolean> {
  const exists = await hasFeed(feed);
  const maxFeeds = config.maxFeeds();
  if (maxFeeds && !exists && (await feedCount()) >= maxFeeds) throw capReached("feed", new FeedLimitError());
  return exists;
}

// After every check, before the first write: the post that creates the feed with a password creates it protected
// (true: this post did). A password (the feed's `X-Feed-Password`) is set only by the post that creates the feed.
// On an instance that sells licenses, a password at creation is for licensed feeds (ADR 0029), and a new feed has no license yet:
// the post brings the key (`X-License-Key`, issue #193), which is checked before the feed is made and put on it right after.
// `created`: the feed was created protected here. `licenseKey`: the key the post that creates an open feed brought, checked already,
// for licenseNewFeed to put on the feed once its first note made it exist.
async function protect(feed: string, ip: string, access: FeedAccess, proved: boolean, exists: boolean, given: string | undefined, wantedReadId: string | undefined, licenseKey: string | undefined): Promise<{ created: boolean; licenseKey?: string }> {
  const password = (access.password ?? given) || undefined; // empty means none
  const key = newFeedKey(proved, exists, licenseKey);
  // A protected feed was already unlocked above; an open existing one can't be claimed.
  if (!proved && password !== undefined) {
    if (exists) throw new FeedExistsError();
    if (key) await countingKeys(ip, () => checkLicenseKey(key));
    else await requireLicense(feed);
    await createProtected(feed, password, wantedReadId);
    // The feed exists now, protected by a password only its creator knows, so nobody else can take the license meanwhile.
    // ponytail: should the store fail here, the feed stays protected and unlicensed; its owner enters the key in the settings.
    if (key) await attachLicense(feed, key);
    return { created: true };
  }
  // A license without a password (#247): the key is checked before anything is stored, so a bad one creates nothing.
  if (key) await countingKeys(ip, () => checkLicenseKey(key));
  // The sender decides how long read() takes, and the feed may have been created protected meanwhile:
  // a post that proved nothing above is checked again, with nothing to show.
  await recheck(feed, ip, access, proved, given);
  return { created: false, licenseKey: key };
}

// The open feed a post just created gets the license its key names (#247). ponytail: should the store fail here, the feed stays
// unlicensed, with its first note; its owner enters the key in the settings.
async function licenseNewFeed(feed: string, key: string | undefined): Promise<void> {
  if (key) await attachLicense(feed, key);
}

// The second access check: a post that proved nothing and brings no password is checked again once its body is read, because the
// feed may have been created protected meanwhile. `postWithPictures` runs it before the caps, so a poster who may not post is
// refused (401) rather than told that the feed is over a cap (507).
async function recheck(feed: string, ip: string, access: FeedAccess, proved: boolean, given: string | undefined): Promise<void> {
  if (!proved && !((access.password ?? given) || undefined)) await checkFeedAccess(feed, {}, ip);
}

// NOTEFEED_IMAGE_UPLOADS=0 (issue #152): no image is stored, whichever way it comes. Before the caps and before anything is
// written, after the access checks: who may not post is told that first.
function refuseImages(images: boolean): void {
  if (images && !config.imageUploads()) throw new ImagesOffError();
}

// The license key this post brings for the feed it creates protected (issue #193): none when it creates no protected feed, or the
// instance sells no licenses (then every feature is open and a key means nothing).
function newFeedKey(proved: boolean, exists: boolean, licenseKey: string | undefined): string | undefined {
  if (proved || exists || !licensingOn()) return undefined;
  return licenseKey?.trim() || undefined;
}

// On an instance with a payment provider, an image needs a licensed feed (ADR 0029); after refuseImages, so "off" is said first.
// The post that creates the feed with a license key is judged by the key, checked here: the license goes on the feed as it is made
// (protect() for a protected one, licenseNewFeed() once an open one's first note is stored).
async function licenseForImages(feed: string, images: boolean, key: string | undefined, ip: string): Promise<void> {
  if (!images) return;
  if (key) await countingKeys(ip, () => checkLicenseKey(key));
  else await requireLicense(feed);
}

// The caps are per type: images have their own, the notes limit counts the markdown ones. `adding` notes of that type; a feed that does not exist yet counts as empty.
async function checkCap(feed: string, typeName: string, adding: number): Promise<void> {
  const image = typeName === "image";
  const max = image ? config.maxImagesPerFeed() : config.maxNotesPerFeed();
  if (adding && max && (await countNotes(feed, typeName)) + adding > max) throw image ? capReached("image", new ImageLimitError()) : capReached("note", new NoteLimitError());
}

// What a post carries: the file (`body`) and the type the poster declared for it (`mediaType`, a Content-Type), with the optional
// metadata (`name` is the file name it came with) and, for the post that creates the feed, a password, a read id and the key of the
// license the password needs (`licenseKey`). `date`: where the note is placed in the feed, if not now (X-Note-Date, read by checkDate).
export type PostInput = { body: Uint8Array; mediaType: string; title?: string; tags?: string[]; alt?: string; name?: string; date?: string; password?: string; readId?: string; licenseKey?: string };

const DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?(?:(Z)|([+-])(\d{2}):(\d{2})))?$/;
const DATE_RULE = "date must be an ISO 8601 date and time with its offset (2026-10-01T09:30:00Z) or a date (2026-10-01), from 1970 to 9999";
// The last millisecond of 9999 (UTC): past it, an ISO string needs a six-digit year.
const LAST = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

// A note's date: undefined (now) for none, else an ISO 8601 date-time with an offset, or a date alone (midnight UTC). Every field is
// checked against the calendar (Date.parse takes 2026-02-30 and 24:00); from 1970 to the end of 9999 (UTC). A time after now is fine:
// it makes the note scheduled.
export function checkDate(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const m = DATE.exec(value);
  if (!m) throw new InvalidBodyError(DATE_RULE);
  const [, y, mo, d, h = "0", mi = "0", s = "0", frac = "", , sign, oh = "0", om = "0"] = m;
  const local = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, frac ? Math.floor(Number(frac) * 1000) : 0));
  const fits = local.getUTCFullYear() === +y && local.getUTCMonth() === +mo - 1 && local.getUTCDate() === +d && local.getUTCHours() === +h && local.getUTCMinutes() === +mi && local.getUTCSeconds() === +s;
  if (!fits || +oh > 23 || +om > 59) throw new InvalidBodyError(DATE_RULE);
  const at = new Date(local.getTime() - (sign === "-" ? -1 : 1) * (+oh * 60 + +om) * 60_000);
  if (at.getTime() < 0 || at.getTime() > LAST) throw new InvalidBodyError(DATE_RULE);
  return at;
}

// `read` runs only once the post is admitted, so a refused request never has its body read.
// A password (the feed's `X-Feed-Password`) is set only by the post that creates the feed.
// `created`: this post created the feed protected, so its sender is the one who chose the password.
// `readId` (in what `read` gives): the read id the new feed should get; ignored when the feed exists, random when empty or left out.
// `licenseKey`: put on the feed this post creates protected; ignored otherwise.
// `readId` (in the result): the read id of the feed the note went into; null when that feed has no read link.
export async function postNote(
  feed: string,
  ip: string,
  read: () => Promise<PostInput>,
  access: FeedAccess,
  sender?: string, // verified by the caller (identity cookie or OAuth token), never taken from a request body
): Promise<{ note: Note; created: boolean; readId: string | null }> {
  const proved = await admit(feed, ip, access);
  const exists = await feedCapped(feed);
  const input = await read();
  const parsed = parseMediaType(input.mediaType);
  if (!parsed) throw new UnsupportedTypeError();
  const { type, ext } = parsed;
  refuseImages(type.name === "image");
  await licenseForImages(feed, type.name === "image", newFeedKey(proved, exists, input.licenseKey), ip);
  if (exists) await checkCap(feed, type.name, 1);
  // Before createProtected: a refused note must not leave a protected, empty feed.
  if (!type.verify(input.body, ext)) throw new UnsupportedTypeError(`the body is not ${parsed.mediaType}`);
  type.checkBody(input.body);
  if (type.name === "image") await refuseBlocked(input.body);
  checkLine("title", input.title, MAX_NOTE_TITLE);
  if (checkLine("alt", input.alt, MAX_ALT) && !type.hasAlt) throw new InvalidBodyError("alt is for image notes");
  const tags = checkTags(input.tags);
  const at = checkDate(input.date);
  const wantedReadId = exists || !input.readId?.trim() ? undefined : input.readId.trim();
  const { created, licenseKey } = await protect(feed, ip, access, proved, exists, input.password, wantedReadId, input.licenseKey);
  // ponytail: checked, not locked. A protected creation can still complete in the few microseconds between
  // this check and createNoteOf's ensureFeed, which then finds the feed and writes into it: this one note is
  // then in the protected feed. A lock around creation, per feed, would close it.
  const made = await createNoteOf(feed, type, ext, input.body, { sender, tags, title: input.title, alt: input.alt, name: input.name, wantedReadId }, at);
  await licenseNewFeed(feed, licenseKey);
  await trimToFreeCap(feed);
  return { ...made, created };
}


// A feed without a note (#295, ADR 0047): reserved now, with a password and a read id if given, as a first post would create it.
// Where licenses are sold it needs a license key, which goes on the new feed (free feeds still start with their first note). It counts
// as a post against the rate limit, and against NOTEFEED_MAX_FEEDS. A feed that exists is refused (409), whatever it holds.
export async function createFeed(feed: string, ip: string, input: { password?: string; licenseKey?: string; readId?: string }): Promise<void> {
  assertFeed(feed);
  if (isHeldBack(feed)) throw new ReservedFeedError();
  if (await isRemovedFeed(feed)) throw new RemovedFeedError();
  const wait = rateLimit(ip);
  if (wait !== null) throw new RateLimitedError(wait);
  if (await feedCapped(feed)) throw new FeedExistsError("feed already exists");
  const password = input.password || undefined; // empty means none
  if (password !== undefined) checkNewPassword(password); // before the key is tried, as recovery does
  const key = licensingOn() ? input.licenseKey?.trim() || undefined : undefined;
  if (licensingOn() && !key) throw new LicenseRequiredError();
  if (key) await countingKeys(ip, () => checkLicenseKey(key));
  const readId = input.readId?.trim() || undefined;
  if (password !== undefined) {
    await createProtected(feed, password, readId).catch((e) => {
      throw e instanceof AuthError ? new FeedExistsError("feed already exists") : e; // created by someone else meanwhile
    });
  } else if (!(await createOpenFeed(feed, readId))) throw new FeedExistsError("feed already exists");
  if (key) await attachLicense(feed, key);
}

// Replacing a note's content, and changing its title or alt text: the same gate as posting, minus the caps.
export async function editContent(feed: string, id: string, ip: string, read: () => Promise<{ body: Uint8Array; mediaType: string }>, access: FeedAccess): Promise<Note> {
  await admit(feed, ip, access);
  const current = await getNote(feed, id);
  if (!current) throw new NotFoundError("no such note"); // before the body is read: a missing note is 404 whatever the body
  refuseImages(current.type.startsWith("image/")); // replacing a picture's bytes is an upload too
  await licenseForImages(feed, current.type.startsWith("image/"), undefined, ip);
  const { body, mediaType } = await read();
  if (parseMediaType(mediaType)?.type.name === "image") await refuseBlocked(body);
  const note = await replaceContent(feed, id, body, mediaType);
  if (!note) throw new NotFoundError("no such note");
  return note;
}

// A note's title, alt text and date (at least one): every value is checked before the first change, the date by checkDate.
export async function editMeta(feed: string, id: string, ip: string, read: () => Promise<{ title?: string; alt?: string; tags?: string[]; date?: string }>, access: FeedAccess): Promise<Note> {
  await admit(feed, ip, access);
  const { date: given, ...meta } = await read();
  const date = checkDate(given);
  const metaGiven = meta.title !== undefined || meta.alt !== undefined || meta.tags !== undefined;
  if (date === undefined && !metaGiven) throw new InvalidBodyError("nothing to change: send title, alt, tags or date");
  let note = metaGiven ? await changeMeta(feed, id, meta) : await getNote(feed, id);
  if (note && date) note = await changeDate(feed, id, date);
  if (!note) throw new NotFoundError("no such note");
  return note;
}

export async function deleteNote(feed: string, id: string, ip: string, access: FeedAccess): Promise<void> {
  await admit(feed, ip, access);
  if (!(await removeNote(feed, id))) throw new NotFoundError("no such note");
}

// Settings and deletion of a whole feed: the same gate as posting, then the feed must exist. An open feed is
// changed by anyone who knows its name, as it is posted to (ADR 0001); a protected one needs its password.
export async function updateFeed(feed: string, ip: string, read: () => Promise<unknown>, access: FeedAccess): Promise<FeedSettings> {
  await admit(feed, ip, access);
  const given = checkSettings(await read()); // after admit: a refused request never has its body read
  if (!(await hasFeed(feed))) throw new NotFoundError("no such feed");
  // Only a given image is checked; an omitted one stays as stored, even if its file has been removed by hand.
  if (given.image && !(await hasImageNote(feed, given.image))) throw new InvalidBodyError("image must be empty or the file of an image note of this feed");
  const stored = await getStoredSettings(feed);
  const { readId, ...rest } = given;
  const newId = readId === undefined || readId === (await readIdOf(feed)) ? undefined : readId; // the page sends the current one back: no change
  if (newId !== undefined && isHeldBack(feed)) throw new InvalidBodyError("a reserved feed keeps its read id");
  // First, so a read id that is refused (taken, badly formed, not allowed) saves nothing.
  if (newId !== undefined) await setReadId(feed, newId === "" ? null : newId);
  const image = rest.image ?? stored.image;
  const ownImage = stored.ownImage && image === stored.image ? true : undefined; // another title image, or none: the own one goes (below)
  const checked = { ...rest, image, showSender: given.showSender ?? stored.showSender, ...(ownImage && { ownImage }) };
  await saveSettings(feed, checked);
  if (stored.ownImage && stored.image && stored.image !== image) await removeOwnImage(feed, stored.image);
  return checked;
}

// The feed's own title image (#310): uploaded as the title image, it is stored as an image note but marked in the settings, so it is
// in no list and was never a post. Every check of posting a picture applies (access, rate limit, a license for images, caps, the
// blocklist). A previous own image is deleted, as nobody posted it; a posted image picked as title image stays a post. The feed must
// exist. `body` empty removes the title image.
export async function setFeedImage(feed: string, ip: string, read: () => Promise<{ body: Uint8Array; mediaType: string }>, access: FeedAccess): Promise<FeedSettings> {
  if (!(await hasFeed(feed))) {
    await admit(feed, ip, access); // a stranger learns nothing a post wouldn't tell
    throw new NotFoundError("no such feed");
  }
  let image = "";
  const input = await (async () => {
    const got = await read();
    if (got.body.length && parseMediaType(got.mediaType)?.type.name !== "image") throw new UnsupportedTypeError("a title image must be an image");
    return got;
  })();
  const stored = await getStoredSettings(feed);
  if (input.body.length) image = (await postNote(feed, ip, async () => input, access)).note.file;
  else await admit(feed, ip, access);
  const now = await getStoredSettings(feed); // after the post: its title and description as they are now
  const saved = { ...now, image, ...(image && { ownImage: true }) };
  if (!image) delete (saved as FeedSettings).ownImage;
  await saveSettings(feed, saved);
  if (stored.ownImage && stored.image && stored.image !== image) await removeOwnImage(feed, stored.image);
  return saved;
}

async function removeOwnImage(feed: string, file: string): Promise<void> {
  const m = /^([A-Za-z0-9_-]{1,128})\./.exec(file);
  if (m) await removeNote(feed, m[1]);
}

// A feed's license, entered (a key) or taken off (null) by whoever may write to the feed (#247): the gate of its settings. Entering
// a key moves its license from the feed it was on. NotFoundError while licenses are not sold here.
export async function setLicense(feed: string, ip: string, key: string | null, access: FeedAccess): Promise<void> {
  if (!licensingOn()) throw new NotFoundError("licenses are not sold on this instance");
  await admit(feed, ip, access);
  if (!(await hasFeed(feed))) throw new NotFoundError("no such feed");
  if (key === null) await detachLicense(feed);
  else await countingKeys(ip, () => attachLicense(feed, key.trim()));
}

export async function deleteFeed(feed: string, ip: string, access: FeedAccess): Promise<void> {
  await admit(feed, ip, access);
  if (!(await removeWholeFeed(feed))) throw new NotFoundError("no such feed");
  await releaseLicense(feed);
}

export { MAX_ATTACHMENTS }; // defined in shared/links.ts: the web box holds to it too

// A picture sent with a markdown text: `name` is the file name the text refers to it by (`![](name)`), kept with the stored note.
export type Picture = { name: string; body: Uint8Array; mediaType: string; alt?: string };
// A post of a text and its pictures. No `text`: just the pictures, each with the title. `date`, `password`, `readId` and `licenseKey` as in PostInput.
export type PostBundle = { text?: string; pictures: Picture[]; title?: string; tags?: string[]; date?: string; password?: string; readId?: string; licenseKey?: string; name?: string };

const MARKDOWN_TYPE = "text/markdown";
const IMAGE_TYPES = MEDIA_TYPES.filter((m) => m.mediaType.startsWith("image/")).map((m) => m.mediaType).join(", ");

// Every check a picture gets before anything is stored; a refusal names it (safeName: a refused name is not echoed as sent).
function checkPictures(pictures: Picture[]): (Picture & { type: NoteType; ext: string })[] {
  refuseImages(pictures.length > 0);
  if (pictures.length > MAX_ATTACHMENTS) throw new InvalidBodyError(`at most ${MAX_ATTACHMENTS} attachments`);
  const seen = new Set<string>();
  return pictures.map((p) => {
    try {
      if (!isAttachmentName(p.name)) throw new InvalidBodyError("not a file name: 1 to 200 characters, no / or \\, no control or text-direction override characters, no leading or trailing space, not only dots");
      if (seen.has(p.name)) throw new InvalidBodyError("the file name is given twice");
      seen.add(p.name);
      const parsed = parseMediaType(p.mediaType);
      if (parsed?.type.name !== "image") throw new UnsupportedTypeError(`send a picture: ${IMAGE_TYPES}`);
      if (p.body.length > config.maxImageBytes()) throw new ImageTooLargeError();
      if (!parsed.type.verify(p.body, parsed.ext)) throw new UnsupportedTypeError(`the body is not ${parsed.mediaType}`);
      parsed.type.checkBody(p.body);
      checkLine("alt", p.alt, MAX_ALT);
      return { ...p, type: parsed.type, ext: parsed.ext };
    } catch (e) {
      if (e instanceof NotefeedError) e.message = `attachment "${safeName(p.name)}": ${e.message}`;
      throw e;
    }
  });
}

// The text as it will be stored, checked before the pictures are: each picture's place holds a file name as long as its stored one will be.
// The text is parsed once, here, in a worker (place.ts); the plan it returns is applied again with the stored file names.
// The length is that of a new id (newNoteId).
async function checkText(text: string, pictures: { name: string; ext: string }[]): Promise<ImagePlan> {
  const id = newNoteId();
  const plan = await planInWorker(text, new Set(pictures.map((p) => p.name)));
  checkMarkdown(applyImages(plan, new Map(pictures.map((p) => [p.name, `${id}.${p.ext}`]))));
  return plan;
}

// Stores the pictures in order, then whatever `then` stores (given the stored notes and the map of file name to stored file); if
// any write fails, the pictures stored so far are removed and the error is rethrown. A picture that can't be removed is logged by its
// note id (never the feed: its name is the write key), so an operator can find the stray file. `dateOf(i)`: picture i's date.
async function storeWithPictures<T>(feed: string, pictures: (Picture & { type: NoteType; ext: string })[], opts: NewNoteOptions, dateOf: (i: number) => Date, then: (stored: Note[], sent: Map<string, string>, readId: string | null) => Promise<T>): Promise<T> {
  const stored: Note[] = [];
  try {
    let readId: string | null = null;
    for (const [i, p] of pictures.entries()) {
      const made = await createNoteOf(feed, p.type, p.ext, p.body, { ...opts, alt: p.alt, name: p.name }, dateOf(i));
      stored.push(made.note);
      readId = made.readId;
    }
    return await then(stored, new Map(pictures.map((p, i) => [p.name, stored[i].file])), readId);
  } catch (e) {
    await Promise.all(
      stored.map(async (n) => {
        const failed = await removeNote(feed, n.id).then((removed) => (removed ? null : {}), (err: unknown) => ({ err }));
        if (failed) log.error({ note: n.id, ...failed }, "a picture of a failed post could not be removed");
      }),
    );
    throw e;
  }
}

// A markdown text with its pictures, as one post: every check first (the pictures, the text, the caps for the existing notes plus
// these), then the pictures in order, then the text with its references to them swapped for the stored files (placeImages). All or
// nothing: a failed write removes the notes this post stored (the feed stays when this post created it). `note` is the text note, or
// with no text the first picture. The rate limit counts the post once. The text's id is drawn first, so each picture records it (`of`);
// at the post's date D (`date`, else now) the text, its n pictures at D − n + i ms: they keep their order and sort just before the text.
export async function postWithPictures(
  feed: string,
  ip: string,
  read: () => Promise<PostBundle>,
  access: FeedAccess,
  sender?: string,
): Promise<{ note: Note; created: boolean; readId: string | null; pictures: Note[] }> {
  const proved = await admit(feed, ip, access);
  const exists = await feedCapped(feed);
  const { text, title, ...input } = await read();
  const pictures = checkPictures(input.pictures);
  await licenseForImages(feed, pictures.length > 0, newFeedKey(proved, exists, input.licenseKey), ip);
  for (const p of pictures) await refuseBlocked(p.body);
  if (text === undefined && pictures.length === 0) throw new InvalidBodyError("send a text, pictures or both");
  const plan = text === undefined ? undefined : await checkText(text, pictures);
  checkLine("title", title, MAX_NOTE_TITLE);
  const tags = checkTags(input.tags);
  const at = checkDate(input.date) ?? new Date();
  await recheck(feed, ip, access, proved, input.password);
  await checkCap(feed, "markdown", text === undefined ? 0 : 1);
  await checkCap(feed, "image", pictures.length);
  const wantedReadId = exists || !input.readId?.trim() ? undefined : input.readId.trim();
  const { created, licenseKey } = await protect(feed, ip, access, proved, exists, input.password, wantedReadId, input.licenseKey);
  const opts = { sender, tags, wantedReadId };
  const id = text === undefined ? undefined : newNoteId();
  const dateOf = (i: number) => new Date(Math.max(0, at.getTime() - pictures.length + i)); // never before 1970
  return storeWithPictures(feed, pictures, { ...opts, title: text === undefined ? title : undefined, of: id }, dateOf, async (stored, sent, readId) => {
    if (text === undefined) {
      await licenseNewFeed(feed, licenseKey);
      return { note: stored[0], created, readId, pictures: stored };
    }
    const made = await createNoteOf(feed, MARKDOWN, "md", encoder.encode(applyImages(plan!, sent)), { ...opts, title, id, name: input.name }, at);
    await licenseNewFeed(feed, licenseKey);
    await trimToFreeCap(feed);
    return { ...made, created, pictures: stored };
  });
}

// A markdown note's new text with its pictures: the same checks and order as postWithPictures, then the text replaces the note's
// (id, title, sender, tags and date stay); `tags` and the sender go on the pictures, which record the note (`of`) and take its date
// minus 1 ms. All or nothing as there.
export async function editWithPictures(
  feed: string,
  id: string,
  ip: string,
  read: () => Promise<{ text: string; pictures: Picture[]; tags?: string[] }>,
  access: FeedAccess,
  sender?: string,
): Promise<{ note: Note; pictures: Note[] }> {
  await admit(feed, ip, access);
  // The note first, as on every other edit: a missing note is 404 and an image note 415 whatever its parts are.
  const note = await getNote(feed, id);
  if (!note) throw new NotFoundError("no such note");
  if (note.type !== MARKDOWN_TYPE) throw new UnsupportedTypeError(`this note is ${note.type}: send that Content-Type`);
  const input = await read();
  const pictures = checkPictures(input.pictures);
  await licenseForImages(feed, pictures.length > 0, undefined, ip); // an edit's feed exists
  for (const p of pictures) await refuseBlocked(p.body);
  const plan = await checkText(input.text, pictures);
  const tags = checkTags(input.tags);
  await checkCap(feed, "image", pictures.length);
  const before = new Date(note.date.getTime() - 1);
  return storeWithPictures(feed, pictures, { sender, tags, of: id }, () => before, async (stored, sent) => {
    const edited = await replaceContent(feed, id, encoder.encode(applyImages(plan, sent)), MARKDOWN_TYPE);
    if (!edited) throw new NotFoundError("no such note");
    return { note: edited, pictures: stored };
  });
}
