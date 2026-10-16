# Read links

Every feed has a **read link**, `https://notes.example.com/r/<read id>/feed.xml`, with a read id of 22 random characters or [one you chose](#choosing-a-feeds-read-id). You find it on the feed page and in every post's answer as `read_url`. A read link:

- serves the feed as RSS (`/r/<read id>/feed.xml`) and as a read-only web page (`/r/<read id>`),
- never shows the feed's name, so it cannot be turned into write access,
- cannot post, edit or delete,
- needs no login on a locked instance and no password on a protected feed.

That makes it the link to give to feed readers, dashboards and other people. Keep the feed name to the scripts that post.

A read link that belongs to no feed answers with an empty feed, not an error, so nobody can probe which exist. A [deleted](feeds.md#feed-settings-in-the-api) feed's read link stays empty for good; a feed created later under the same name gets a new one.

!!! warning "Older feeds and the server secret"
    Feeds created before feed deletion existed have no stored read id: theirs is computed from the name and `NOTEFEED_SECRET`. Changing the secret changes their read links. See [Configuration](../self-hosting/configuration.md).

## The read-only view

`/r/<read id>` shows the notes without the compose box, under the feed's title, description and title image, with a **Subscribe** button for the RSS feed. Each note opens at `/r/<read id>/<id>`, which is also its link in RSS. With [sign-in](../self-hosting/sign-in/index.md) on, it shows who posted, unless the feed's **Show who posted** setting is off.

## Choosing a feed's read id

The feed's name never changes, but its read id can be chosen: 3 to 64 characters of `a-z`, `0-9`, `-` and `_`.

- **At creation:** send `X-Read-Id` with the post that creates the feed.
- **Later:** `read_id` in the body of `PUT /api/v1/feeds/<feed>`, or the **Read id** field on the settings page. An empty value gives a new random one.
- A read id another feed holds is `409`. An operator can turn chosen read ids off (`NOTEFEED_ALLOW_CUSTOM_IDS=0`).

What to know:

- **A short, readable read id can be guessed.** Protect the feed with a [password](feed-passwords.md) if that matters.
- **The old read id is freed.** The old link answers like an unknown one until another feed takes that id. Tell the people who have it.
- **Notes are not edited.** `![](file)` references follow the new read id; a full URL in a note does not.
