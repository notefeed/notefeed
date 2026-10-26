---
name: create-notefeed-feed
description: Create a new notefeed feed for the user - pick a secret feed name, the public read id, title and description, put a license on it at the start when they have one, and save it so other skills (post-to-notefeed) can post there. Use when the user asks to create, start or set up a notefeed feed, a blog or a notes feed on notefeed, or when another skill needs a feed that doesn't exist yet.
---

# Create a notefeed feed

On notefeed a feed is just a name: whoever knows it can read, post, edit and delete. **The
feed name is the password**, so it is long and random, it is saved before anything is posted,
and it never appears in a reply. Readers get the read link, `<url>/r/<read_id>`, which only
reads.

The notefeed MCP tools (`post_note`, `get_feed`, `update_feed`) must be there; if not, see
*Before anything* in the `post-to-notefeed` skill.

## 1. Ask, in one go

Only what you can't default:

- **What it is for**, which becomes its short name in `feeds.json` (`blog`, `releases`,
  `homelab`).
- **The instance**: default `https://notefeed.me`, or their own.
- **The read id**: the public part of the address, 3 to 64 characters of `a-z`, `0-9`, `-`
  and `_`. Suggest one from the purpose.
- **Title and description** readers see, one line each.
- **A drafts feed** for reviewing before posting (`post-to-notefeed` uses it): yes or no.
- **On notefeed.me, a license key**, if they have one (see step 3). Point to
  https://notefeed.me/license if they want one. A self-hosted instance has no licenses.

## 2. Make and save the names

Make the feed names yourself and write them into `~/.config/notefeed/feeds.json` (or
`$NOTEFEED_FEEDS`) **before** the first post, so a name is never lost:

```bash
umask 077; mkdir -p ~/.config/notefeed
F="<short name>-$(openssl rand -hex 8)"; D="drafts-$(openssl rand -hex 8)"
```

```json
{ "feeds": { "blog": { "url": "https://notefeed.me", "feed": "blog-…", "read_id": "you", "drafts_feed": "drafts-…" } } }
```

Merge into an existing file, never overwrite other entries, and keep it at mode 600. Without a
file system (claude.ai), give the user the names to keep in their password manager and in the
project instructions.

The license key is not saved there: it is also the way to the subscription and its invoices,
so it stays in the user's password manager. Don't repeat it in replies either.

## 3. Create the feed

A feed is created by its first note. Post one with `post_note` on the new feed name, with
`read_id`: a short first note that says what the feed is for (show it to the user first), or
the user's first real note through `post-to-notefeed`.

**The license at the start.** notefeed takes a license key only on the post that creates the
feed, and only together with a feed password (`password` and `license_key` on that
`post_note`). A feed password is a second secret readers and posters need on top of the feed
name, which is already secret; it is only worth it when the feed name may be seen by others
(shared with a script or a co-author who shouldn't read everything). So:

- **Key and a feed password wanted:** both on the first `post_note`. Generate the password like
  the feed name and save it as `password` in the entry; every later call on the feed needs it.
- **Key, no password:** create the feed without them; then the user enters the key in the
  feed's settings (**License** → *Use key*), which they open at `<url>/<feed name>` from their
  password manager. Offer to show that link, since it contains the feed name.
- **No key:** the feed starts on the free tier; a key can be entered in the settings later.

A taken read id fails the post: ask for another. A `402` means the key is missing or inactive,
a `400` that it is not a key.

## 4. Settings and report

1. `update_feed` with the title and description.
2. `get_feed`: check the read id, and read `free_tier`, which is `null` for a licensed feed and
   otherwise the cap of notes it keeps (`{ notes, cap }`; at the cap, each new note drops the
   oldest).
3. Tell the user: the read link and its RSS (`<url>/r/<read_id>/feed.xml`); that the feed
   name, saved in `feeds.json`, works like a password and belongs in their password manager;
   the license state (licensed, or free tier with its cap and that pictures and a feed password
   need a license).
4. Offer the next step: the first note with `post-to-notefeed`. A website can show the feed
   without any secret through the read API, `GET <url>/api/v1/read/<read_id>/notes?limit=100`
   (paged with `before=<next>`; each note has `title`, `content` in markdown, `tags`,
   `created_at` and `id`).
