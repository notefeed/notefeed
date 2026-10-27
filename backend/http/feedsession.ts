// POST /<feed>/access: the web UI's plain forms for a feed password (unlock, lock, change, remove, recover, and protect: an open
// feed gets one, ADR 0044), and create: a feed without a note (ADR 0047).
// Always answers with a redirect back to the feed page (unlock, lock) or the settings page (change, remove); the cookie is the feed's unlock cookie.
import { AuthError, InvalidRequestError, NotefeedError } from "../errors";
import { createFeed } from "../posting";
import { changePassword, feedCookieName, protectedFeed, recoverPassword, removePassword, unlock } from "../feedlock";
import { assertFeed } from "../feeds";
import { clientIp } from "../limits";
import { API_PREFIX, feedPath, publicUrl, settingsPath } from "../urls";
import { errorResponse } from "./errors";
import { authorize, errorRedirect, parseForm, readCapped, sameOrigin, seeOther } from "./request";

const YEAR = 60 * 60 * 24 * 365;

// The unlock cookie as Set-Cookie headers; an empty value with age 0 clears it. Set twice, for the page's
// path and for the feed's API path, because the web UI's fetch() calls /api/v1/feeds/<feed>/...; both
// match on a "/" boundary, so feed foo's cookie never reaches foobar. Secure behind https.
export function feedCookies(h: Headers, feed: string, value: string, age = YEAR): [string, string][] {
  const secure = publicUrl(h).startsWith("https:") ? "; Secure" : "";
  return [`/${feed}`, `${API_PREFIX}/feeds/${feed}`].map((path) => [
    "Set-Cookie",
    `${feedCookieName(feed)}=${value}; Path=${path}; Max-Age=${age}; HttpOnly; SameSite=Lax${secure}`,
  ]);
}

export async function feedAccessRoute(req: Request, feed: string): Promise<Response> {
  const h = req.headers;
  const page = feedPath(feed);
  const set = (value: string) => feedCookies(h, feed, value);
  const clear = () => feedCookies(h, feed, "", 0);
  let back = page; // where a refusal goes: the form it came from
  try {
    assertFeed(feed); // before anything touches the disk
    const bytes = await readCapped(req, 4096);
    const form = bytes ? await parseForm(bytes, h).catch(() => null) : null;
    const field = (name: string) => String(form?.get(name) ?? "");
    const action = field("action");
    if (!["unlock", "lock", "change", "remove", "recover", "protect", "create"].includes(action)) throw new InvalidRequestError("unknown action");
    if (action === "change" || action === "remove") back = settingsPath(feed);
    if (action === "protect") back = `${settingsPath(feed)}?form=protect`; // the settings page opens its "protect this feed" part
    if (action === "create") back = `${page}?form=create`; // the new feed's "Protect this feed" card
    // Recovery is on the unlock screen and, for a browser that is still unlocked, in the settings' password row (#297): each opens its
    // own "forgot the password" part.
    const fromSettings = field("from") === "settings";
    if (action === "recover") back = fromSettings ? `${settingsPath(feed)}?form=recover#access` : `${page}?form=recover`;
    // Only this instance's own pages may send these: they set, use or drop the cookie's session, and another
    // site's form must not spend a visitor's password attempts either.
    if (!sameOrigin(h)) throw new AuthError();
    if (action === "unlock") {
      if (!(await protectedFeed(feed))) return seeOther(page);
      return seeOther(page, set(await unlock(feed, field("password"), clientIp(h))));
    }
    if (action === "lock") return seeOther(page, clear());
    // A feed without a note (#295, ADR 0047), from the new feed's card: a protected one leaves this browser unlocked for it.
    if (action === "create") {
      authorize(h, clientIp(h)); // a locked instance's own password (or session) first, as every other way to create a feed needs it
      const password = field("password");
      await createFeed(feed, clientIp(h), { password, licenseKey: field("key") });
      return password ? seeOther(`${page}?created=1`, set(await unlock(feed, password, clientIp(h)))) : seeOther(`${page}?created=1`);
    }
    if (action === "protect") return seeOther(saved(feed, "set"), set(await changePassword(feed, "", field("next"), clientIp(h))));
    if (action === "recover") {
      const cookie = await recoverPassword(feed, field("key").trim(), field("next"), clientIp(h));
      return cookie === null ? seeOther(page, clear()) : seeOther(saved(feed, "recovered"), set(cookie));
    }
    if (action === "remove") {
      await removePassword(feed, field("current"), clientIp(h));
      return seeOther(page, clear()); // the feed is open now: its settings page would redirect anyway
    }
    return seeOther(saved(feed, "changed"), set(await changePassword(feed, field("current"), field("next"), clientIp(h))));
  } catch (e) {
    if (!(e instanceof NotefeedError)) throw e;
    if (["invalid_feed", "reserved_feed", "invalid_request"].includes(e.code)) return errorResponse(e);
    return errorRedirect(back, e);
  }
}

// A password change says so in the password row, which the page scrolls to (#296); `saved=1` is the profile's "Saved." at the top.
function saved(feed: string, what: "set" | "changed" | "recovered"): string {
  return `${settingsPath(feed)}?saved=password-${what}#access`;
}
