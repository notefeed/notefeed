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

## Files by name

Every note's file is at `/r/<read id>/<file>`, its `file_url`, which changes with every new note. For a file that changes, such as a skill or a config, give the notes a name: `X-Note-Name` on the post (`name` in the clients and the MCP server's `post_note`). The read link then serves the newest note with that name at `/r/<read id>/<name>`:

```sh
curl -H "Content-Type: text/markdown" -H "X-Note-Name: post-to-notefeed.md" --data-binary @SKILL.md "$NOTEFEED_URL/$FEED"
curl -O "$NOTEFEED_URL/r/$READ_ID/post-to-notefeed.md"   # always the newest version
```

- **Post again under the same name for a new version.** The earlier ones stay in the feed, each at its own `file_url`. Deleting the newest makes the one before it the current one again; an edit keeps the name.
- **A name ending in a lower-case extension**, such as `.md` or `.png`, is served this way (`my%20file.md` for a space). The type comes from the note, not the name: markdown is served as text, a picture as its image type.
- **A note's own file name comes first:** a name that is another note's `<id>.<ext>` never takes its address. A note dated later is served by its name from its date on.
- Public like the read link, with no password, as every file is.

## Choosing a feed's read id

The feed's name never changes, but its read id can be chosen: 3 to 64 characters of `a-z`, `0-9`, `-` and `_`.

- **At creation:** send `X-Read-Id` with the post that creates the feed.
- **Later:** `read_id` in the body of `PUT /api/v1/feeds/<feed>`, or the **Read id** field on the settings page. An empty value gives a new random one.
- A read id another feed holds is `409`. An operator can turn chosen read ids off (`NOTEFEED_ALLOW_CUSTOM_IDS=0`).

What to know:

- **A short, readable read id can be guessed.** Protect the feed with a [password](feed-passwords.md) if that matters.
- **The old read id is freed.** The old link answers like an unknown one until another feed takes that id. Tell the people who have it.
- **Notes are not edited.** `![](file)` references follow the new read id; a full URL in a note does not.
