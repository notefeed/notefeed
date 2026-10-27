# Sharing from a phone

Send a picture, a text or a link from another app on your phone to a feed: Photos → Share → notefeed → pick the feed → Post.

## Android

[Install notefeed as an app](web-ui.md#install-it-as-an-app) (Chrome: **Add to Home Screen** or **Install app**) and open it once. From then on it is in the share sheet of other apps:

1. Share one or more pictures, a text or a link and pick **notefeed**.
2. The start page asks which feed it goes to: one of **Your feeds** (the feeds this browser has opened), or type a name.
3. That feed's compose box opens with the pictures waiting and the text filled in. Add words if you like, then **Post**.

What to know:

- **The pictures stay on the phone until you post.** They wait in the browser, not on the server; nothing is uploaded before **Post**, and sharing something new replaces what was waiting.
- **Shrunk and checked like any picture** you add in the compose box: PNG, JPEG, GIF and WebP, at most 10 per note (the first 10 are attached), shrunk to 1 MiB before upload. Other files don't offer notefeed in the share sheet. See [Pictures](pictures.md).
- **A protected feed or a locked instance** asks for its password or the sign-in first; what you shared is still there afterwards.
- **Open notefeed once after installing (or after clearing the browser's data for it).** Sharing pictures needs the small helper the app installs on its first visit (a service worker). Without it, the share fails with "not found"; open notefeed and share again.

## iPhone

iOS doesn't put web apps in the share sheet, so the way in there is a Shortcut that posts to the [API](posting.md). Set it up once in the **Shortcuts** app:

1. **New shortcut**, then in its details turn on **Show in Share Sheet** and let it receive **Images**.
2. **Dictionary**: one entry per feed, the feed name as key and its [feed password](feed-passwords.md) as value (empty for an open feed).
3. **Choose from List** with the dictionary's keys: the feed. **Get Dictionary Value** for that key: the password.
4. **Ask for Input** (text, "Caption"), which may be left empty.
5. **Repeat with Each** item of the Shortcut Input:
    - **Convert Image** to **JPEG**, with **Preserve Metadata** off: iPhone photos are HEIC, which notefeed does not take, and this drops where the photo was taken.
    - **Resize Image** to 2048 on the longest edge, so a photo stays under the 5 MiB limit.
    - **Add to Variable** `Pictures`.
6. **Get Contents of URL**: `https://<your instance>/<feed>` (the chosen feed), method **POST**, request body **Form** with a field `file` of type File set to `Pictures`, and, only when the caption is not empty (an **If** around it), a field `text` with the caption. Under **Headers** add `X-Feed-Password` with the password when it is not empty.
7. **Show Result** or **Show Notification** with the answer.

With a caption, the pictures arrive as one note with them attached; without one, each picture is a note of its own (see [Posting a note with its pictures](pictures.md#posting-a-note-with-its-pictures)).

!!! note "Not tried on a device yet"
    The action names follow Apple's Shortcuts app; the recipe has not been run on an iPhone yet. If a step is named differently or the form field takes only one file, open an issue.

!!! note "On notefeed.me"
    Pictures need a license: on the free tier every picture is refused with `402`. See [Free tier and licenses](../hosted/licenses.md).

The resize step goes away once the server shrinks pictures itself ([#312](https://github.com/notefeed/notefeed/issues/312)).
