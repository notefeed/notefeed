# Sharing from a phone

Send a picture, a text or a link from another app on your phone to a feed: Photos → Share → notefeed → pick the feed → Post.

## Android

[Install notefeed as an app](web-ui.md#install-it-as-an-app) with **Chrome** (**Add to Home Screen** or **Install app**) and open it once. Installed from Samsung Internet, notefeed is in the share sheet, but sharing only opens the start page ([#314](https://github.com/notefeed/notefeed/issues/314)). From then on it is in the share sheet of other apps:

1. Share one or more pictures, a text or a link and pick **notefeed**.
2. The start page asks which feed it goes to: one of **Your feeds** (the feeds this browser has opened), or type a name.
3. That feed's compose box opens with the pictures waiting and the text filled in. Add words if you like, then **Post**.

What to know:

- **The pictures stay on the phone until you post.** They wait in the browser, not on the server; nothing is uploaded before **Post**, and sharing something new replaces what was waiting.
- **Shrunk and checked like any picture** you add in the compose box: PNG, JPEG, GIF and WebP, at most 10 per note (the first 10 are attached), shrunk to 1 MiB before upload. Other files don't offer notefeed in the share sheet; shared along with pictures, they are left out. See [Pictures](pictures.md).
- **A protected feed or a locked instance** asks for its password or the sign-in first; what you shared is still there afterwards.
- **Open notefeed once after installing (or after clearing the browser's data for it).** Sharing pictures needs the small helper the app installs on its first visit (a service worker). Without it, the share fails with "not found"; open notefeed and share again.

## iPhone

iOS doesn't put web apps in the share sheet, so the way in there is a Shortcut. notefeed has a ready-made one:

1. On the iPhone, open the feed's **Settings**, then **Share from an iPhone**, and tap **the notefeed Shortcut** (or open `https://<your instance>/shortcuts/notefeed.shortcut`). Add it.
2. It asks four things: the instance's address (`https://notefeed.me`), the feed's name, its [password](feed-passwords.md) (empty for an open feed), and, **optional**, a server password: leave it empty unless your own self-hosted server asks for a password when you sign in (`NOTEFEED_PASSWORD`). notefeed.me has none. The settings page shows the address and the name, and says whether the server has a password.
3. Share pictures, text or a link from any app and pick **notefeed**. It sits at the very bottom of the share sheet, below the actions; **Edit Actions** there can move it up.

Everything shared in one go arrives as one note: the text, if any, with every picture below it. The Shortcut posts each picture on its own first, then the note that shows them, so the feed and RSS show the pictures inside the note only (iOS Shortcuts sends just one file per request). Photos are converted to JPEG on the phone, as notefeed does not take HEIC; the server shrinks them and removes their metadata. The note opens in the browser when it has arrived. A page shared from a browser arrives as its address, not as the page's text. A note shared from Notes arrives as its text, in markdown, with its pictures below it; Notes' checklists keep their ✓ and ◦, but not their indentation. A picture that is refused (too large, say) doesn't stop the others: the note is posted without it, and the Shortcut says which failed and why. A note that is refused (a wrong password) is shown with notefeed's reason.

The first time, iOS asks whether the Shortcut may send the pictures to your notefeed address and open it: answer **Always Allow**. A **No** stays until you change it in the Shortcut's details (**ⓘ** → **Privacy**).

The Shortcut posts to `POST /api/v1/feeds/<feed>/notes` with `X-Feed-Password` and `Authorization: Bearer <server password>`; a server without a password ignores the second. It is built from source (`shortcut/source.ts`) and signed, as iOS imports only signed Shortcuts.

!!! note "On notefeed.me"
    Pictures need a license: on the free tier every picture is refused with `402`. See [Free tier and licenses](../hosted/licenses.md).

