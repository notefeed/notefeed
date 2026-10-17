# Web UI

## The start page

Open notefeed in a browser. The start page asks for a feed name and suggests a random one; press **Open** to go to `/<name>`. The instance keeps no list of feeds: you only reach a feed by knowing its name. The feeds this browser has opened are remembered in the browser only, as **Your feeds**: in the left column on a wide screen, behind the feed's name on a phone. **Forget on this device** takes one off.

!!! warning "Pick a hard-to-guess name"
    Anyone who knows a feed's name can read it, post to it, edit and delete its notes, and delete the feed. Keep the suggested name or make up something as random.

## A feed page

`/<feed>` shows the feed's details at the top (title, description, name, the share, RSS, read-only and settings buttons, and its tags), a box to write a note, and the newest 50 notes as cards grouped by day. A feed with no notes yet shows a `curl` command to post the first one; it exists from its first note.

![A notefeed feed page: the feeds in a left column, the compose box above the notes as cards, and the feed's details, read link and tags on the right](../assets/screenshot-light.png#only-light)
![A notefeed feed page: the feeds in a left column, the compose box above the notes as cards, and the feed's details, read link and tags on the right](../assets/screenshot-dark.png#only-dark)

### Writing a note

Type markdown into the box and press **Post** or ++ctrl+enter++ (++cmd+enter++ on a Mac). The box has a **Title** field, a tags field (comma-separated, `ci, deploy`) and a preview (the eye button), rendered the way the feed will show the note. On a phone the box is a bar at the bottom, like a chat; **+** opens the whole box as a sheet. The camera button next to **Send** takes a photo for the note; tap it again for more. Posting goes through the same `POST /<feed>` as scripts, with the same [rate limit](../self-hosting/limits.md), and needs JavaScript; without it, use the [API](posting.md).

### Adding an image

The **Add image** button in the box's toolbar takes PNG, JPEG, GIF or WebP files; pasting or dropping an image works too. Each picture waits in the box with a small preview, and `![](name)` goes into the text. When you post, text and pictures are sent in [one request](pictures.md#posting-a-note-with-its-pictures). If something is refused, the page says why and keeps your text and pictures; nothing is half-posted. Pictures are posted as they are, EXIF data included, and are as public as the [read link](#the-read-link): see [Pictures](pictures.md).

### Reading, editing and deleting

Notes are listed newest first, each with its title, text, tags, sender (when the feed shows one) and time, in the server's time zone. Raw HTML is shown as text, never run. Click a title to open the note's own page, `/<feed>/<id>`, where **Edit** opens the markdown and the title, **Copy link** copies its address, and **Delete** asks you to confirm before the note is gone for good. An edited note keeps its address and its place in the list. Anyone who can open the feed can edit and delete its notes.

### Tags

A note's [tags](posting.md#tags) show on its card and page. Each is a link that filters the list to that tag (`?tag=ci`), with a **Show all notes** link above it. The feed's details list the tags of the notes on the page.

### The read link

Once the feed has a note, **Share** hands the [read link](read-links.md) to your device's share sheet, or copies it. The RSS and read-only buttons sit next to it, and the settings page has the links under **Sharing**. Give the read link to feed readers and to people who should see the notes but not post.

The settings button (the cog) opens the feed's [settings page](feeds.md#feed-settings-in-the-web-ui). An instance can show a **Report** link on every note: see [A report link on every note](../self-hosting/legal-pages.md#a-report-link-on-every-note).

## About and legal pages

The links to the documentation, the source code and the operator's [imprint, privacy and terms pages](../self-hosting/legal-pages.md) are in the footer of the start page, and behind **About & legal** (the ⓘ button) on a feed's pages.

!!! note "On notefeed.me"
    The footer also links the [license page](https://notefeed.me/license), where a license for a feed is bought and its subscription managed. See [Free tier and licenses](../hosted/licenses.md).

## With an instance password

If the instance has a password (`NOTEFEED_PASSWORD`), every page except the read-only views and the legal pages asks for it first. The login lasts a year on that browser; **Log out** ends it there. To log out every browser, change the password and restart notefeed. Wrong passwords count toward the [rate limit](../self-hosting/limits.md).

## Install it as an app

notefeed ships a web manifest and icons, so a browser can install it as an app (**Install** in Chrome and Edge, **Add to Home Screen** on a phone). On Android the installed app is in the system share sheet: share a text or a link to it and it asks which feed it goes to. A link pasted into a chat shows a preview with the notefeed wordmark; set `PUBLIC_URL` on a public instance so the preview's image URL is right.
