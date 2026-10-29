// The backend's boundary: the only module the frontend (app/, components/, proxy.ts) may import from
// backend/ (enforced in eslint.config.mjs). Calls are in-process today. Each query below is shaped like
// the endpoint it would become if the backend moved out, so the cut would be here and nowhere else.
import { config } from "./config";
import { identityOn, providers } from "./oidc/config";
import { forReaders, getSettings } from "./feedsettings";
import { isReadId, checkFeed, feedForReadId, hasFeed, readIdOf } from "./feeds";
import { countNotes, getNote, ImageNote, isDraft, isRemovedNote, isScheduled, listNotes, MarkdownNote, type Note } from "./notes";
import { imagePath, readPath } from "./urls";

// The notes the backend hands out; the classes are exported so a component test can build one.
export { ImageNote, MarkdownNote };
export { UnreadableNote } from "./note/unreadable";
export { RemovedNote } from "./note/removed";
export { UnreadableNoteError } from "./errors";
export type { Note };
// Dated after now: only its owner sees it, marked "Scheduled for" (components/NoteFoot.tsx).
export { isDraft, isScheduled };
export { IDENTITY_COOKIE, SESSION_COOKIE, identitySender, locked, sessionOk } from "./auth";
export { checkFeed, isHeldBack as isReservedFeed, isRemovedFeed, isRemovedReadId, readIdOf } from "./feeds";
export { identityOn };
export { feedPath, publicUrl, readPath, rssPath, safeNext, settingsPath } from "./urls";
// Every write is one of these HTTP handlers; the frontend only mounts them and renders.
export { dispatch } from "./http/api";
export { measured } from "./metrics";
export { noteOutcome } from "./requestscope";
export { hasLegalPage, licensePageOn, readLegalPage, readLicensePage, readNotice, type LegalPage } from "./legal";
export { metricsRoute } from "./http/metrics";
export { healthRoute } from "./http/health";
export { attachRoute, checkoutRoute, feedLicenseRoute, keyRoute, webhookRoute } from "./http/licenses";
export { moveImagesRoute, resealRoute, takedownRoute, unreferencedImagesRoute } from "./http/operator";
export { feedCookieName, feedUnlocked } from "./feedlock";
export { feedDeleteRoute, feedSettingsRoute } from "./http/feedforms";
export { feedAccessRoute } from "./http/feedsession";
export { loginRoute, logoutRoute } from "./http/session";
export { fileRoute } from "./http/files";
export { rssRoute } from "./http/rss";
export { mcpRoute } from "./mcp";
export { oidcCallbackRoute, oidcStartRoute } from "./oidc/routes";
export { authServerRoute, authorizeRoute, checkAuthorize, metadataPreflight, protectedResourceRoute, registerPreflight, registerRoute, tokenRoute } from "./oauth/routes";

export { freeNoteCap, freeTier, isLicensed, licenseAccountUrl, licensePlans, licensingOn } from "./licensing";

export const instanceTitle = config.title;
/** The address of the footer's Support link; "" for none. */
export const supportEmail = config.supportEmail;

/** The sign-in providers for the buttons, in order: id (for /api/oidc/start?provider=) and label; empty while identity is off. */
export const signInProviders = (): { id: string; label: string }[] => providers().map(({ id, label }) => ({ id, label }));

/** The feeds NOTEFEED_FOOTER_FEEDS names (releases, a blog), for the footer and the ⓘ menu, linked by their read id: the feed's
 * title, else its name. A name that is no feed, or a feed without a read link, is left out. */
export async function footerFeedLinks(): Promise<{ href: string; label: string }[]> {
  const links = await Promise.all(
    config.footerFeeds().map(async (feed) => {
      const readId = checkFeed(feed) === null ? await readIdOf(feed) : null; // a bad name must not reach the lookup
      return readId ? { href: readPath(readId), label: (await getSettings(feed)).title || feed[0].toUpperCase() + feed.slice(1) } : null;
    }),
  );
  return links.filter((l) => l !== null);
}

/** Whether the instance password is set (sign-in alone can lock an instance too). */
export const passwordSet = () => config.password() !== "";

/** Whether a feed's owner may choose its read id (NOTEFEED_ALLOW_CUSTOM_IDS); otherwise only a random one. */
export const customIdsOn = config.allowCustomIds;

/** The template of the "Report" link on every note (NOTEFEED_REPORT_URL, issue #154), or "" for no link. */
export const reportTemplate = config.reportUrl;
/** Where the built-in report page posts (NOTEFEED_REPORT_ENDPOINT, issue #156), or "" for no page. */
export const reportEndpoint = config.reportEndpoint;
/** Whether pictures can be posted (NOTEFEED_IMAGE_UPLOADS); off, the note boxes show no image control (issue #152). */
export const imageUploadsOn = config.imageUploads;

const PAGE = 50;

/**
 * A feed by its (writable) name: newest notes and its read id; null for an invalid or reserved name.
 * No read id while the feed has no notes: a name nobody has posted to has no feed (and no id) yet, and a
 * legacy feed's id is derived from the name, so showing one would hand out the read link of whatever
 * feed is created there later. None either for a feed whose stored read id can't be read (backend/feeds.ts).
 */
export async function getFeed(feed: string, tag?: string): Promise<{ notes: Note[]; readId: string | null; exists: boolean; title: string; description: string; image: string; showSender: boolean; imageUrl: string | null } | null> {
  if (checkFeed(feed)) return null;
  const notes = await listNotes(feed, PAGE, undefined, tag, undefined, true);
  // `exists`: a feed that had notes and lost them still exists (it counts toward the feed cap and can't get a password).
  const readId = (await countNotes(feed)) ? await readIdOf(feed) : null; // not notes.length: a tag filter can show none of a feed's notes
  const settings = await getSettings(feed);
  // The title image's path under the read id (it is served there, never under the feed's name).
  return { notes, readId, exists: await hasFeed(feed), ...settings, imageUrl: readId && settings.image ? imagePath(readId, settings.image) : null };
}

/** A feed's image notes, newest first (at most 50), for choosing its title image: the file and its path under the read id. */
export async function getFeedImages(feed: string): Promise<{ file: string; url: string; title: string }[]> {
  if (checkFeed(feed)) return [];
  const readId = await readIdOf(feed);
  if (!readId) return [];
  return (await listNotes(feed, PAGE, undefined, undefined, "image")).map((n) => ({ file: n.file, url: imagePath(readId, n.file), title: n.title }));
}

/** A feed's picture notes (the newest 50), for the links from a markdown note's pictures to their pages (shared/notekinds.ts). */
export async function getFeedPictures(feed: string): Promise<Note[]> {
  return checkFeed(feed) ? [] : listNotes(feed, PAGE, undefined, undefined, "image");
}

/** The same by the read id: those a reader sees at `asOf` (the request's time, shared with getReadNote). */
export async function getReadPictures(readId: string, asOf = new Date()): Promise<Note[]> {
  const feed = isReadId(readId) ? await feedForReadId(readId) : null;
  return feed ? listNotes(feed, PAGE, undefined, undefined, "image", false, asOf) : [];
}

export async function getFeedNote(feed: string, id: string): Promise<Note | null> {
  return getNote(feed, id); // null for an invalid or reserved feed name too
}

/** A feed by its read id: null for a malformed id; an unknown one is an empty feed, so ids can't be probed. Like every reader view it
 *  shows the notes dated up to the request's time: a scheduled note is a missing one until then. */
export async function getReadFeed(id: string, tag?: string): Promise<{ notes: Note[]; title: string; description: string; imageUrl: string | null } | null> {
  if (!isReadId(id)) return null;
  const asOf = new Date();
  const feed = await feedForReadId(id);
  const settings = feed ? await getSettings(feed, asOf) : { title: "", description: "", image: "", showSender: true };
  const { title, description, image } = settings;
  return { notes: feed ? forReaders(await listNotes(feed, PAGE, undefined, tag, undefined, true, asOf), settings) : [], title, description, imageUrl: image ? imagePath(id, image) : null };
}

/** A feed's title and title image by its read id, without its notes: the card beside one of its notes (#307). */
export async function getReadFeedAbout(id: string): Promise<{ title: string; imageUrl: string | null }> {
  const feed = isReadId(id) ? await feedForReadId(id) : null;
  if (!feed) return { title: "", imageUrl: null };
  const { title, image } = await getSettings(feed, new Date());
  return { title, imageUrl: image ? imagePath(id, image) : null };
}

/** `asOf`: the request's time (shared with getReadPictures). */
export { isRemovedNote };
/** Whether the operator removed the note under this read id (#159): its page says so, with its mark and after the mark is deleted. */
export async function isRemovedReadNote(readId: string, id: string, asOf = new Date()): Promise<boolean> {
  const feed = await feedForReadId(readId);
  return !!feed && (await isRemovedNote(feed, id, asOf)); // as a reader: only a note it could have seen
}
export async function getReadNote(readId: string, id: string, asOf = new Date()): Promise<Note | null> {
  const feed = await feedForReadId(readId);
  const note = feed ? await getNote(feed, id, asOf) : null;
  return note && feed ? forReaders([note], await getSettings(feed))[0] : null;
}
export { runningVersion, type RunningVersion } from "./version";
