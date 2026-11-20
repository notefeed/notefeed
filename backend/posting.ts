// The one way a note gets posted, edited or deleted, for the HTTP API, MCP and the web UI alike. Credentials are the
// caller's job (bearer vs. session cookie); everything after that is here, in this order.
import { checkNoteMeta } from "./notefields";
import { config } from "./config";
import { applyImages, type ImagePlan } from "../shared/imagePlan.mjs";
import { isAttachmentName, MAX_ATTACHMENTS, safeName } from "../shared/links";
import {
  AuthError,
  BlockedImageError,
  FeedExistsError,
  FeedNameTakenError,
  FeedLimitError,
  ImageLimitError,
  ImagesOffError,
  ImageTooLargeError,
  InvalidBodyError,
  InvalidRequestError,
  NotefeedError,
  NoteLimitError,
  NotFoundError,
  LicenseRequiredError,
  RateLimitedError,
  RemovedFeedError,
  ReservedFeedError,
  TitleImageDraftError,
  UnsupportedTypeError,
} from "./errors";
import {
  type FeedAccess,
  checkFeedAccess,
  checkNewPassword,
  createProtected,
  feedOwnership,
  requireOwner,
  ownedFeeds,
  ownersChanged,
  ownNewFeed,
  requireOwnerIfOwned,
} from "./feedlock";
import { type FeedSettings, checkSettings, getStoredSettings, saveSettings } from "./feedsettings";
import {
  assertFeed,
  createOpenFeed,
  deleteFeed as removeWholeFeed,
  feedCount,
  hasFeed,
  isHeldBack,
  isRemovedFeed,
  readIdOf,
  renameFeed,
  setReadId,
} from "./feeds";
import { isLicensed, licensingOn, requireLicense, requireLicensesSold, trimToFreeCap } from "./licensing";
import { activeUnits } from "./accounts/subscriptions";
import { isBlockedImage } from "./takedown";
import { processImage } from "./imageprocess";
import type { ImageType } from "../shared/images";
import { capReached, rateLimit } from "./limits";
import { logger } from "./log";
import { MEDIA_TYPES } from "./note/media";
import { planInWorker } from "./place";
import { limitOf, makeUpload, uploadType, type NewUpload } from "./uploads";
import { fetchPublic } from "./fetchurl";
import { ACCEPTED_TYPES } from "./note/media";
import { type NoteType, parseMediaType } from "./note/types";
import { checkTags } from "./tags";
import {
  changeDate,
  changeDraft,
  checkLine,
  checkMarkdown,
  countNotes,
  createNoteOf,
  encoder,
  getNote,
  MARKDOWN,
  hasImageNote,
  MAX_ALT,
  newNoteId,
  refuseRemovedNote,
  removeNote,
  replaceContent,
  changeMeta,
  givesMetaEdit,
  type MetaEdit,
  type NewNoteOptions,
  type Note,
} from "./notes";

const log = logger("posting");

// The gate every write passes first: the feed's access, then the rate limit (counted once per request). Whether the
// password was proved. Writes to a feed with an active license don't count against the per-IP limit (ADR 0046, #123): a paid
// feed's CI bursts never get a 429 from it; wrong passwords and keys still count in their own bucket, checked before this. An edit or delete targets an existing note, so its feed already exists, and the feed's
// protection can only be changed by a request that proved the password: no second access check after `read()`, unlike a post.
async function admit(feed: string, ip: string, access: FeedAccess): Promise<boolean> {
  assertFeed(feed);
  if (await isRemovedFeed(feed)) throw new RemovedFeedError(); // the operator took the name out of use (issue #155): before any password is looked at
  const proved = await checkFeedAccess(feed, access, ip);
  if (licensingOn() && (await isLicensed(feed))) return proved;
  const wait = rateLimit(ip);
  if (wait !== null) throw new RateLimitedError(wait);
  return proved;
}

// What a file that comes later (an upload, a fetched URL) must pass first: the feed's access, counted as a post, so it opens nothing a
// post wouldn't; a picture is refused at once where image uploads are off or the feed has no license for it, and so is a new feed past
// NOTEFEED_MAX_FEEDS. Whether the caller proved the feed's password comes back. The post itself runs every check again.
async function admitFile(feed: string, ip: string, access: FeedAccess, isImage: boolean): Promise<boolean> {
  assertFeed(feed);
  refuseImages(isImage);
  const proved = await admit(feed, ip, access);
  // Where licenses are sold, a picture needs a licensed feed (or room in the account's license for a new one): said now, before a
  // file is sent or fetched that could never be posted.
  await licenseForImages(feed, isImage, await feedCapped(feed), access);
  return proved;
}

// A file from a public URL, for MCP's source_url (#422, ADR 0066): admitted like an upload before anything is fetched, so no one makes
// the server fetch for a feed they can't post to. `type`, when given, is what the file must be; else the site's Content-Type says.
// The post that follows runs every check on the bytes (the type by its signature, the size, the license).
export async function fetchSource(feed: string, ip: string, access: FeedAccess, url: string, type?: string): Promise<{ body: Uint8Array; mediaType: string }> {
  if (!config.fetchUrls()) throw new InvalidRequestError("source_url is off on this instance (NOTEFEED_FETCH_URLS=0): send the file as data or upload_id");
  assertFeed(feed);
  const given = type === undefined ? undefined : uploadType(type);
  await admitFile(feed, ip, access, given?.isImage ?? false);
  const fetched = await fetchPublic(url, { maxBytes: limitOf(given?.isImage ?? true) });
  if (given) return { body: fetched.body, mediaType: given.mediaType };
  try {
    return { body: fetched.body, mediaType: uploadType((fetched.mediaType ?? "").split(";")[0].trim()).mediaType };
  } catch {
    throw new UnsupportedTypeError(`source_url: the site calls the file ${fetched.mediaType ?? "nothing"}; give type, one of ${ACCEPTED_TYPES}`);
  }
}

// An upload (#381, ADR 0064), made after admitFile.
export async function createUpload(feed: string, ip: string, access: FeedAccess, type: string, size?: number): Promise<NewUpload> {
  assertFeed(feed);
  const t = uploadType(type);
  const proved = await admitFile(feed, ip, access, t.isImage);
  // Who the per-sender cap counts: an account, else a feed's password (its own feed's cap counts that), else the address. Many
  // people share one address (claude.ai's connectors, an instance without NOTEFEED_TRUST_PROXY), so it comes last.
  const sender = access.account ? `account:${access.account}` : proved ? `feed:${feed}` : `ip:${ip}`;
  return makeUpload(feed, sender, t, size);
}

// An image the operator removed may not come back, in any feed (issue #155).
async function refuseBlocked(body: Uint8Array): Promise<void> {
  if (await isBlockedImage(body)) throw new BlockedImageError();
}

// An image as it will be stored: decoded, shrunk and stripped (imageprocess.ts, ADR 0049). The takedown list is checked against
// the bytes as sent and as stored: an entry made from either holds, so re-sending a removed original doesn't get around it.
// The last check before anything is stored, after the cheap ones, so a request that is refused anyway costs no processing.
async function prepareImage(body: Uint8Array, ext: string): Promise<Uint8Array> {
  await refuseBlocked(body);
  const stored = await processImage(body, ext as ImageType);
  await refuseBlocked(stored);
  return stored;
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
// On an instance that sells licenses, a password at creation is for licensed feeds (ADR 0029): the feed it creates goes under the
// posting account's license (ADR 0061), which needs a unit free. `created`: the feed was created protected here.
async function protect(
  feed: string,
  ip: string,
  access: FeedAccess,
  proved: boolean,
  exists: boolean,
  given: string | undefined,
  wantedReadId: string | undefined,
): Promise<{ created: boolean }> {
  const password = (access.password ?? given) || undefined; // empty means none
  // A protected feed was already unlocked above; an open existing one can't be claimed.
  if (!proved && password !== undefined) {
    if (exists) throw new FeedExistsError();
    await requireRoom(access.account);
    await createProtected(feed, password, wantedReadId, access.account);
    await coverNewFeed(feed, access.account);
    return { created: true };
  }
  // The sender decides how long read() takes, and the feed may have been created protected meanwhile:
  // a post that proved nothing above is checked again, with nothing to show.
  await recheck(feed, ip, access, proved, given);
  return { created: false };
}

// A new feed that needs a license from the start (a password, pictures, or made without a note where licenses are sold): the posting
// account must have a unit of its license free. Nothing where licenses aren't sold. LicenseRequiredError otherwise.
async function requireRoom(account: string | undefined): Promise<void> {
  if (!licensingOn()) return;
  if (!account) throw new LicenseRequiredError("this needs a license: sign in with an account that has one");
  await (await import("./feedlock")).requireFreeUnit(account);
}

// Puts a feed this request just made under the account's license, where licenses are sold (requireRoom checked there is room).
async function coverNewFeed(feed: string, account: string | undefined): Promise<void> {
  if (!licensingOn() || !account) return;
  const { setCovered } = await import("./feedlock");
  await setCovered(feed, account, true, await activeUnits(account));
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

// On an instance with a payment provider, an image needs a licensed feed (ADR 0029); after refuseImages, so "off" is said first. A post
// that creates the feed with pictures needs room in the posting account's license, and the feed goes under it.
async function licenseForImages(feed: string, images: boolean, exists: boolean, access: FeedAccess): Promise<void> {
  if (!images || !licensingOn()) return;
  if (exists) await requireLicense(feed);
  else await requireRoom(access.account);
}

// The notes limit counts every note of the feed (texts, images, the operator's marks); images have a limit of their own as well.
// `adding`: the notes a write adds, and how many of them are images. A feed that does not exist yet counts as empty.
async function checkCaps(feed: string, adding: { notes: number; images: number }): Promise<void> {
  const maxImages = config.maxImagesPerFeed();
  if (adding.images && maxImages && (await countNotes(feed, "image")) + adding.images > maxImages) throw capReached("image", new ImageLimitError());
  const maxNotes = config.maxNotesPerFeed();
  if (adding.notes && maxNotes && (await countNotes(feed)) + adding.notes > maxNotes) throw capReached("note", new NoteLimitError());
}

// What a post carries: the file (`body`) and the type the poster declared for it (`mediaType`, a Content-Type), with the optional
// metadata (`name` is the file name it came with) and, for the post that creates the feed, a password and a read id. `date`: where the note is placed in the feed, if not now (X-Note-Date, read by checkDate).
// `draft`: stored as a draft, which readers do not see until it is published (X-Note-Draft, #265).
export type PostInput = {
  body: Uint8Array;
  mediaType: string;
  title?: string;
  sender?: string; // as given with the note: wins over the signed-in one; "" is none
  tags?: string[];
  alt?: string;
  name?: string;
  date?: string;
  draft?: boolean;
  language?: string; // ADR 0063
  password?: string;
  readId?: string;
};

// `read` runs only once the post is admitted, so a refused request never has its body read.
// A password (the feed's `X-Feed-Password`) is set only by the post that creates the feed.
// `created`: this post created the feed protected, so its sender is the one who chose the password.
// `readId` (in what `read` gives): the read id the new feed should get; ignored when the feed exists, random when empty or left out.
// `readId` (in the result): the read id of the feed the note went into; null when that feed has no read link.
export async function postNote(
  feed: string,
  ip: string,
  read: () => Promise<PostInput>,
  access: FeedAccess,
  signedIn?: string, // the signed-in name (Better Auth session or OAuth token): the sender unless the post gives its own
): Promise<{ note: Note; created: boolean; readId: string | null }> {
  const proved = await admit(feed, ip, access);
  const exists = await feedCapped(feed);
  const input = await read();
  const parsed = parseMediaType(input.mediaType);
  if (!parsed) throw new UnsupportedTypeError();
  const { type, ext } = parsed;
  refuseImages(type.name === "image");
  await licenseForImages(feed, type.name === "image", exists, access);
  if (exists) await checkCaps(feed, { notes: 1, images: type.name === "image" ? 1 : 0 });
  // Before createProtected: a refused note must not leave a protected, empty feed.
  if (!type.verify(input.body, ext)) throw new UnsupportedTypeError(`the body is not ${parsed.mediaType}`);
  type.checkBody(input.body);
  const meta = checkNoteMeta(input);
  const byOwner = await postedByOwner(feed, input.sender, access, exists);
  const sender = byOwner ? undefined : senderOf(input.sender, meta.sender, signedIn);
  if (meta.alt && !type.hasAlt) throw new InvalidBodyError("alt is for image notes");
  const tags = meta.tags ?? [];
  const at = meta.date;
  const body = type.name === "image" ? await prepareImage(input.body, ext) : input.body;
  const wantedReadId = exists || !input.readId?.trim() ? undefined : input.readId.trim();
  const { created } = await protect(feed, ip, access, proved, exists, input.password, wantedReadId);
  // ponytail: checked, not locked. A protected creation can still complete in the few microseconds between
  // this check and createNoteOf's ensureFeed, which then finds the feed and writes into it: this one note is
  // then in the protected feed. A lock around creation, per feed, would close it.
  const made = await createNoteOf(
    feed,
    type,
    ext,
    body,
    { sender, tags, title: input.title, alt: input.alt, name: input.name, language: meta.language, wantedReadId, draft: input.draft, byOwner },
    at,
  );
  if (!exists) await ownNewFeed(feed, access.account); // a feed an account's post made is that account's (ADR 0059)
  if (!exists && !created && type.name === "image") await coverNewFeed(feed, access.account); // pictures need its license from the start
  await trimToFreeCap(feed);
  return { ...made, created };
}

// Whether a post is the feed owner's own with no sender of its own (ADR 0059): then it carries the mark, not a name. A feed this post
// creates becomes the posting account's, so its first note is the owner's too.
async function postedByOwner(feed: string, given: string | undefined, access: FeedAccess, exists: boolean): Promise<boolean> {
  if (given !== undefined || !access.account) return false;
  const ownership = await feedOwnership(feed, access.account);
  return ownership === "yours" || (!exists && ownership === "unowned");
}

// The sender a post stores: its own (checked by checkNoteMeta; "" is none), else the signed-in name.
const senderOf = (given: string | undefined, checked: string | undefined, signedIn: string | undefined): string | undefined =>
  given === undefined ? signedIn : checked || undefined;

// A feed without a note (#295, ADR 0047): reserved now, with a password and a read id if given, as a first post would create it.
// Where licenses are sold it needs a signed-in account with room in its license, and goes under it (free feeds still start with their
// first note; ADR 0061). It counts
// as a post against the rate limit, and against NOTEFEED_MAX_FEEDS. A feed that exists is refused (409), whatever it holds.
// `account`: the signed-in account creating it, whose feed it then is (ADR 0059).
export async function createFeed(feed: string, ip: string, input: { password?: string; readId?: string }, account?: string): Promise<void> {
  assertFeed(feed);
  if (isHeldBack(feed)) throw new ReservedFeedError();
  if (await isRemovedFeed(feed)) throw new RemovedFeedError();
  const wait = rateLimit(ip);
  if (wait !== null) throw new RateLimitedError(wait);
  if (await feedCapped(feed)) throw new FeedExistsError("feed already exists");
  const password = input.password || undefined; // empty means none
  if (password !== undefined) checkNewPassword(password);
  await requireRoom(account);
  const readId = input.readId?.trim() || undefined;
  if (password !== undefined) {
    await createProtected(feed, password, readId, account).catch((e) => {
      throw e instanceof AuthError ? new FeedExistsError("feed already exists") : e; // created by someone else meanwhile
    });
  } else if (!(await createOpenFeed(feed, readId))) throw new FeedExistsError("feed already exists");
  else await ownNewFeed(feed, account);
  await coverNewFeed(feed, account);
}

// Replacing a note's content, and changing its title or alt text: the same gate as posting, minus the caps.
export async function editContent(
  feed: string,
  id: string,
  ip: string,
  read: () => Promise<{ body: Uint8Array; mediaType: string }>,
  access: FeedAccess,
): Promise<Note> {
  await admit(feed, ip, access);
  await refuseRemovedNote(feed, id); // the operator's mark is not edited, and the note it stands for does not come back (#159)
  const current = await getNote(feed, id);
  if (!current) throw new NotFoundError("no such note"); // before the body is read: a missing note is 404 whatever the body
  refuseImages(current.type.startsWith("image/")); // replacing a picture's bytes is an upload too
  await licenseForImages(feed, current.type.startsWith("image/"), true, {});
  const { body, mediaType } = await read();
  const parsed = parseMediaType(mediaType);
  // A body of another type than the note's is refused by replaceContent, without being processed first.
  const image = parsed?.type.name === "image" && parsed.mediaType === current.type;
  const note = await replaceContent(feed, id, image ? await prepareImage(body, parsed.ext) : body, mediaType);
  if (!note) throw new NotFoundError("no such note");
  return note;
}

// A note's title, alt text, sender, tags, language and date (at least one): every value is checked before the first change
// (checkNoteMeta), and a lang: tag in new tags becomes the language (ADR 0063).
// `draft`: true makes the note a draft, false publishes it, its pictures along (#265); its date stays.
export async function editMeta(
  feed: string,
  id: string,
  ip: string,
  read: () => Promise<MetaEdit & { date?: string; draft?: boolean }>,
  access: FeedAccess,
): Promise<Note> {
  await admit(feed, ip, access);
  await refuseRemovedNote(feed, id);
  const { date: given, draft, ...givenMeta } = await read();
  const checked = checkNoteMeta({ ...givenMeta, date: given }); // every value checked before the first change
  const { date } = checked;
  const meta: MetaEdit = { ...givenMeta, ...(checked.tags !== undefined && { tags: checked.tags, language: checked.language }) };
  const metaGiven = givesMetaEdit(meta);
  if (date === undefined && draft === undefined && !metaGiven)
    throw new InvalidBodyError("nothing to change: send title, alt, tags, sender, language, date or draft");
  if (draft !== undefined) {
    // A picture posted with a note is a draft when its note is: published alone, it would show readers part of a draft (V3).
    const of = (await getNote(feed, id))?.of;
    if (of !== undefined && (await getNote(feed, of))) throw new InvalidBodyError("this picture follows its note: make the note a draft or publish it");
  }
  if (draft === true && (await isTitleImageOf(feed, id))) throw new TitleImageDraftError(); // before any change: all or nothing
  let note = metaGiven ? await changeMeta(feed, id, meta) : await getNote(feed, id);
  if (note && date) note = await changeDate(feed, id, date);
  if (note && draft !== undefined) note = await changeDraft(feed, id, draft);
  if (!note) throw new NotFoundError("no such note");
  return note;
}

// Whether the feed's title image is the note `id` or a picture posted with it: such a note must not become a draft (readers see the image).
async function isTitleImageOf(feed: string, id: string): Promise<boolean> {
  const { image } = await getStoredSettings(feed);
  const imageId = image.split(".")[0];
  if (!image || imageId === id) return !!image;
  return (await getNote(feed, imageId))?.of === id;
}

export async function deleteNote(feed: string, id: string, ip: string, access: FeedAccess): Promise<void> {
  await admit(feed, ip, access);
  if (!(await removeNote(feed, id))) throw new NotFoundError("no such note");
}

// Settings and deletion of a whole feed: the same gate as posting, then the feed must exist. An open feed is
// changed by anyone who knows its name, as it is posted to (ADR 0001); a protected one needs its password.
// `name` (#350) renames the feed, last, after everything else is saved under the old name; the answer's `feed` is the name it has now.
export async function updateFeed(feed: string, ip: string, read: () => Promise<unknown>, access: FeedAccess): Promise<FeedSettings & { feed: string }> {
  await admit(feed, ip, access);
  const given = checkSettings(await read()); // after admit: a refused request never has its body read
  if (!(await hasFeed(feed))) throw new NotFoundError("no such feed");
  // Only a given image is checked; an omitted one stays as stored, even if its file has been removed by hand.
  // A draft picture would show readers what they must not see (#265).
  if (given.image && (!(await hasImageNote(feed, given.image)) || (await getNote(feed, given.image.split(".")[0]))?.draft))
    throw new InvalidBodyError("image must be empty or the file of an image note of this feed that is not a draft");
  const stored = await getStoredSettings(feed);
  const { readId, name, ...rest } = given;
  const newName = name === undefined || name === "" || name === feed ? undefined : name; // the page sends the current one back: no change
  if (newName !== undefined) await requireOwnerIfOwned(feed, access.account); // an owned feed is renamed by its owner only
  if (newName !== undefined) await checkRename(feed, newName); // first, so a refused name saves nothing
  const newId = readId === undefined || readId === (await readIdOf(feed)) ? undefined : readId; // the page sends the current one back: no change
  if (newId !== undefined && isHeldBack(feed)) throw new InvalidBodyError("a reserved feed keeps its read id");
  // First, so a read id that is refused (taken, badly formed, not allowed) saves nothing.
  if (newId !== undefined) await setReadId(feed, newId === "" ? null : newId);
  const image = rest.image ?? stored.image;
  const ownImage = stored.ownImage && image === stored.image ? true : undefined; // another title image, or none: the own one goes (below)
  // The sender name is the owner's (ADR 0059): a change from anyone else, or on a feed without an owner, is refused.
  const senderName = given.senderName ?? stored.senderName ?? "";
  if (senderName !== (stored.senderName ?? "")) await requireOwner(feed, access.account);
  const checked = { ...rest, image, showSender: given.showSender ?? stored.showSender, ...(ownImage && { ownImage }), ...(senderName && { senderName }) };
  await saveSettings(feed, checked);
  if (stored.ownImage && stored.image && stored.image !== image) await removeOwnImage(feed, stored.image);
  if (newName !== undefined) await renameWithLicense(feed, newName);
  if (newName !== undefined) ownersChanged();
  return { ...checked, feed: newName ?? feed };
}

// What renameFeed would refuse, asked before anything is saved: a bad, reserved or taken name.
async function checkRename(feed: string, to: string): Promise<void> {
  if (isHeldBack(feed)) throw new InvalidBodyError("a reserved feed keeps its name");
  assertNewName(to);
  if (await hasFeed(to)) throw new FeedNameTakenError();
}

function assertNewName(to: string): void {
  try {
    assertFeed(to);
  } catch (e) {
    if (e instanceof ReservedFeedError) throw new FeedNameTakenError();
    throw new InvalidBodyError("name must be 1 to 64 characters: a-z, 0-9, - and _");
  }
}

// The feed's license goes with it: it is in its record (ADR 0061), which renaming keeps.
const renameWithLicense = (feed: string, to: string) => renameFeed(feed, to);

// The feed's own title image (#310): uploaded as the title image, it is stored as an image note but marked in the settings, so it is
// in no list and was never a post. Every check of posting a picture applies (access, rate limit, a license for images, caps, the
// blocklist). A previous own image is deleted, as nobody posted it; a posted image picked as title image stays a post. The feed must
// exist. `body` empty removes the title image.
export async function setFeedImage(
  feed: string,
  ip: string,
  read: () => Promise<{ body: Uint8Array; mediaType: string }>,
  access: FeedAccess,
): Promise<FeedSettings> {
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

// Puts the owner's feed under its account's license, or takes it off (ADR 0061): only the owner, and no more feeds than the license's
// units. NotFoundError while licenses are not sold here.
export async function setFeedCovered(feed: string, ip: string, covered: boolean, access: FeedAccess): Promise<void> {
  requireLicensesSold();
  await admit(feed, ip, access);
  if (!(await hasFeed(feed))) throw new NotFoundError("no such feed");
  const { setCovered } = await import("./feedlock");
  await setCovered(feed, access.account, covered, access.account ? await activeUnits(access.account) : 0);
}

export async function deleteFeed(feed: string, ip: string, access: FeedAccess): Promise<void> {
  await admit(feed, ip, access);
  await requireOwnerIfOwned(feed, access.account); // an owned feed is deleted by its owner only (ADR 0059)
  if (!(await removeWholeFeed(feed))) throw new NotFoundError("no such feed");
  ownersChanged();
}

// A feed with everything in it, and its license given back: the operator's, and an account's own when the account goes.
export async function removeFeedAndLicense(feed: string): Promise<boolean> {
  if (!(await removeWholeFeed(feed))) return false;
  ownersChanged();
  return true;
}

// Deleting an account (ADR 0059): its feeds first, then the account. Should it stop in between, the account is still there to try
// again; should it stop after a feed's deletion failed, that feed stays owned by an account that is gone, which nobody can claim and
// the operator decides about (/api/operator/feeds).
export async function deleteAccountWithFeeds(userId: string): Promise<void> {
  for (const feed of await ownedFeeds(userId)) await removeFeedAndLicense(feed);
  // Its subscriptions end at the provider, so nothing is charged again (ADR 0061).
  await (await import("./licenseflow")).endSubscriptionsOf(userId);
  const { deleteAccount } = await import("./accounts/numbers");
  await deleteAccount(userId);
}

export { MAX_ATTACHMENTS }; // defined in shared/links.ts: the web box holds to it too

// A picture sent with a markdown text: `name` is the file name the text refers to it by (`![](name)`), kept with the stored note.
export type Picture = { name: string; body: Uint8Array; mediaType: string; alt?: string };
// A post of a text and its pictures. No `text`: just the pictures, each with the title. `date`, `password` and `readId` as in PostInput.
export type PostBundle = {
  text?: string;
  pictures: Picture[];
  title?: string;
  sender?: string; // as in PostInput
  tags?: string[];
  date?: string;
  draft?: boolean;
  language?: string; // ADR 0063: on the text note, or with no text on each picture, like the title
  password?: string;
  readId?: string;
  name?: string;
};

const MARKDOWN_TYPE = "text/markdown";
const IMAGE_TYPES = MEDIA_TYPES.filter((m) => m.mediaType.startsWith("image/"))
  .map((m) => m.mediaType)
  .join(", ");

// A checked picture. `key`: what the text can call it by, its file name; a name sent more than once (a phone's every photo is
// "image.jpg") gets a key no text can hold, so such pictures are appended, and only a text that names one of them is refused (checkText).
type Checked = Picture & { type: NoteType; ext: string; key: string };

// Every check a picture gets before anything is stored; a refusal names it (safeName: a refused name is not echoed as sent).
function checkPictures(pictures: Picture[]): Checked[] {
  refuseImages(pictures.length > 0);
  if (pictures.length > MAX_ATTACHMENTS) throw new InvalidBodyError(`at most ${MAX_ATTACHMENTS} attachments`);
  const repeated = repeatedNames(pictures);
  return pictures.map((p, i) => {
    try {
      if (!isAttachmentName(p.name))
        throw new InvalidBodyError(
          "not a file name: 1 to 200 characters, no / or \\, no control or text-direction override characters, no leading or trailing space, not only dots",
        );
      const parsed = parseMediaType(p.mediaType);
      if (parsed?.type.name !== "image") throw new UnsupportedTypeError(`send a picture: ${IMAGE_TYPES}`);
      if (p.body.length > config.maxImageBytes()) throw new ImageTooLargeError();
      if (!parsed.type.verify(p.body, parsed.ext)) throw new UnsupportedTypeError(`the body is not ${parsed.mediaType}`);
      parsed.type.checkBody(p.body);
      checkLine("alt", p.alt, MAX_ALT);
      return { ...p, type: parsed.type, ext: parsed.ext, key: repeated.has(p.name) ? `\0${i}` : p.name }; // a file name holds no control character
    } catch (e) {
      if (e instanceof NotefeedError) e.message = `attachment "${safeName(p.name)}": ${e.message}`;
      throw e;
    }
  });
}

const repeatedNames = (pictures: { name: string }[]) => new Set(pictures.map((p) => p.name).filter((n, i, all) => all.indexOf(n) !== i));

// The text as it will be stored, checked before the pictures are: each picture's place holds a file name as long as its stored one will be.
// The text is parsed once, here, in a worker (place.ts); the plan it returns is applied again with the stored file names.
// The length is that of a new id (newNoteId). A text that refers to a name sent more than once is refused: which picture it means is a guess.
async function checkText(text: string, pictures: { name: string; ext: string; key: string }[]): Promise<ImagePlan> {
  const id = newNoteId();
  const repeated = repeatedNames(pictures);
  const found = await planInWorker(text, new Set([...pictures.map((p) => p.key), ...repeated]));
  const named = found.edits.find((e) => repeated.has(e.name));
  if (named) throw new InvalidBodyError(`attachment "${safeName(named.name)}": the text refers to a file name given more than once`);
  const plan = { ...found, unused: found.unused.filter((n) => !repeated.has(n)) };
  checkMarkdown(applyImages(plan, new Map(pictures.map((p) => [p.key, `${id}.${p.ext}`]))));
  return plan;
}

// Stores the pictures in order, then whatever `then` stores (given the stored notes and the map of file name to stored file); if
// any write fails, the pictures stored so far are removed and the error is rethrown. A picture that can't be removed is logged by its
// note id (never the feed: its name is the write key), so an operator can find the stray file. `dateOf(i)`: picture i's date.
async function storeWithPictures<T>(
  feed: string,
  pictures: Checked[],
  opts: NewNoteOptions,
  dateOf: (i: number) => Date,
  then: (stored: Note[], sent: Map<string, string>, readId: string | null) => Promise<T>,
): Promise<T> {
  const stored: Note[] = [];
  try {
    let readId: string | null = null;
    for (const [i, p] of pictures.entries()) {
      const made = await createNoteOf(feed, p.type, p.ext, p.body, { ...opts, alt: p.alt, name: p.name }, dateOf(i));
      stored.push(made.note);
      readId = made.readId;
    }
    return await then(stored, new Map(pictures.map((p, i) => [p.key, stored[i].file])), readId);
  } catch (e) {
    await Promise.all(
      stored.map(async (n) => {
        const failed = await removeNote(feed, n.id).then(
          (removed) => (removed ? null : {}),
          (err: unknown) => ({ err }),
        );
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
  signedIn?: string, // as in postNote
): Promise<{ note: Note; created: boolean; readId: string | null; pictures: Note[] }> {
  const proved = await admit(feed, ip, access);
  const exists = await feedCapped(feed);
  const { text, title, ...input } = await read();
  const pictures = checkPictures(input.pictures);
  await licenseForImages(feed, pictures.length > 0, exists, access);
  if (text === undefined && pictures.length === 0) throw new InvalidBodyError("send a text, pictures or both");
  const plan = text === undefined ? undefined : await checkText(text, pictures);
  const meta = checkNoteMeta({ title, sender: input.sender, tags: input.tags, date: input.date, language: input.language });
  const placed = { language: meta.language }; // ADR 0063: where the title goes
  const byOwner = await postedByOwner(feed, input.sender, access, exists);
  const sender = byOwner ? undefined : senderOf(input.sender, meta.sender, signedIn);
  const tags = meta.tags ?? [];
  const at = meta.date ?? new Date();
  await recheck(feed, ip, access, proved, input.password);
  await checkCaps(feed, { notes: (text === undefined ? 0 : 1) + pictures.length, images: pictures.length });
  for (const p of pictures) p.body = await prepareImage(p.body, p.ext); // one at a time: a post never fills the queue alone
  const wantedReadId = exists || !input.readId?.trim() ? undefined : input.readId.trim();
  const { created } = await protect(feed, ip, access, proved, exists, input.password, wantedReadId);
  const opts = { sender, tags, wantedReadId, draft: input.draft, byOwner };
  const id = text === undefined ? undefined : newNoteId();
  const dateOf = (i: number) => new Date(Math.max(0, at.getTime() - pictures.length + i)); // never before 1970
  const onPictures = text === undefined ? { title, ...placed } : {};
  return storeWithPictures(feed, pictures, { ...opts, ...onPictures, of: id }, dateOf, async (stored, sent, readId) => {
    if (!exists) await ownNewFeed(feed, access.account);
    if (!exists && !created && pictures.length) await coverNewFeed(feed, access.account); // pictures need its license from the start
    if (text === undefined) return { note: stored[0], created, readId, pictures: stored };
    const made = await createNoteOf(feed, MARKDOWN, "md", encoder.encode(applyImages(plan!, sent)), { ...opts, title, ...placed, id, name: input.name }, at);
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
  await refuseRemovedNote(feed, id);
  // The note first, as on every other edit: a missing note is 404 and an image note 415 whatever its parts are.
  const note = await getNote(feed, id);
  if (!note) throw new NotFoundError("no such note");
  if (note.type !== MARKDOWN_TYPE) throw new UnsupportedTypeError(`this note is ${note.type}: send that Content-Type`);
  const input = await read();
  const pictures = checkPictures(input.pictures);
  await licenseForImages(feed, pictures.length > 0, true, {}); // an edit's feed exists
  const plan = await checkText(input.text, pictures);
  const tags = checkTags(input.tags);
  await checkCaps(feed, { notes: pictures.length, images: pictures.length });
  for (const p of pictures) p.body = await prepareImage(p.body, p.ext);
  const before = new Date(note.date.getTime() - 1);
  return storeWithPictures(
    feed,
    pictures,
    { sender, tags, of: id, draft: note.draft },
    () => before,
    async (stored, sent) => {
      const edited = await replaceContent(feed, id, encoder.encode(applyImages(plan, sent)), MARKDOWN_TYPE);
      if (!edited) throw new NotFoundError("no such note");
      return { note: edited, pictures: stored };
    },
  );
}
