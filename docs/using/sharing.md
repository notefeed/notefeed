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
2. It asks four things: the instance's address (`https://notefeed.me`), the feed's name, its [password](feed-passwords.md) (empty for an open feed), and the server password, the one you sign in to a self-hosted instance with (`NOTEFEED_PASSWORD`; empty on notefeed.me and wherever there is none). The settings page shows the address and the name, and says whether the server has a password.
3. Share pictures, text or a link from any app and pick **notefeed**. It sits at the very bottom of the share sheet, below the actions; **Edit Actions** there can move it up.

Everything shared in one go arrives as one note: the text with every picture ([Posting a note with its pictures](pictures.md#posting-a-note-with-its-pictures)), or, without text, the pictures alone. Photos are converted to JPEG on the phone, as notefeed does not take HEIC; the server shrinks them and removes their metadata. The note opens in the browser when it has arrived; a refusal (a wrong password, a picture too large) is shown with notefeed's reason.

The Shortcut posts to `POST /api/v1/feeds/<feed>/notes` with `X-Feed-Password` and `Authorization: Bearer <server password>`; a server without a password ignores the second. It is built from source (`shortcut/source.ts`) and signed, as iOS imports only signed Shortcuts.

!!! note "On notefeed.me"
    Pictures need a license: on the free tier every picture is refused with `402`. See [Free tier and licenses](../hosted/licenses.md).

