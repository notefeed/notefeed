# Posting notes

A note is a file. Post its bytes to `POST /<feed>` and say in `Content-Type` what kind of file it is:

```sh
curl -H "Content-Type: text/markdown" --data-binary @note.md https://notes.example.com/homelab-7f3k2q9x4m8wz
```

The feed is created by its first note; there is nothing to set up. notefeed answers `201` with the note's `id`, its `url` in the web UI, the feed's `read_url` (the RSS link for readers, see [Read links](read-links.md)) and the note's `file` and `file_url`. The file on disk is the body exactly as posted. From Python or Node, the [client libraries](../integrations/clients.md) build the request for you.

!!! tip "Use `--data-binary`, not `-d`"
    `curl -d` strips newlines. And set the `Content-Type`: without it curl sends a form type, which notefeed refuses with `415`.

## Types

`Content-Type` is required and nothing is guessed:

| Content type | A note of |
|---|---|
| `text/markdown` | markdown, UTF-8, at most 100 KB |
| `image/png`, `image/jpeg`, `image/gif`, `image/webp` | a [picture](pictures.md) of that format |
| `multipart/form-data` | a note [with its pictures](pictures.md#posting-a-note-with-its-pictures) |

Anything else, including `text/plain` and no type at all, is `415`. A body that is not what it declares is refused too.

## With an instance password

If the instance has a password (`NOTEFEED_PASSWORD`), send it as a bearer token:

```sh
curl -H "Authorization: Bearer $NOTEFEED_PASSWORD" -H "Content-Type: text/markdown" \
  --data-binary @note.md https://notes.example.com/homelab-7f3k2q9x4m8wz
```

A feed can have a password of its own as well: see [Feed passwords](feed-passwords.md).

## Titles

A markdown note shows its text as written. Where a name is needed (RSS, the API, the browser's title) it is titled by its first heading, or else its first line. To set a title of your own, send `X-Note-Title` (at most 100 characters, one line), or fill in the **Title** field in the web UI; `PATCH` changes it later. The title is metadata, not part of the file: replacing the content keeps it, and an empty title makes the note follow its text again. A title of your own also shows as the heading above the text.

## Tags

Tags are short labels, such as `ci`, `deploy` or `failed`, so readers and tools can tell notes apart:

```sh
curl -H "Content-Type: text/markdown" -H "X-Note-Tags: ci,deploy" --data-binary '# Deploy finished' "$NOTEFEED_URL/$FEED"
```

- At most 10 per note, each 1 to 32 characters of lowercase letters, digits, `-`, `_`, `.` and `:`.
- Tags are free labels set by whoever posts: no identity, no access. They show on the read link and in RSS like the note itself.
- `?tag=ci` on the feed page, the read-only view, the note list of the API and the RSS feed (`/r/<read id>/feed.xml?tag=ci`) shows only notes with that tag.
- Tags are set when a note is posted and cannot be changed afterwards.

## A note's date

Every note has a date: when it is placed in its feed, the read link and RSS. It is the time of posting unless you send `X-Note-Date`:

```sh
curl -H "Content-Type: text/markdown" -H "X-Note-Date: 2025-03-01T09:30:00+01:00" --data-binary @note.md "$NOTEFEED_URL/$FEED"
```

- An ISO 8601 date and time with its offset (`Z`, `+01:00`), or a date alone, which is midnight UTC. Any time from 1970 to the end of 9999.
- **In the past:** the note takes its place by that date, as if it had been posted then. An old changelog entry is one example.
- **In the future:** the note is scheduled. Readers do not see it (not on the read link, in RSS or in the read API; its address answers `404`) until its date. You see it on the feed page and in the API, marked as scheduled. Nothing runs at that time: the note is there when the next request comes after it.
- On a multipart post every note gets the date, the images a millisecond before the text. Images posted with a note move with it: when the note's date changes, theirs change with it. An image posted on its own and only linked from a note keeps its own date: schedule it too if it must not be seen before the note.
- On a feed with a free note cap, the oldest notes by date go first. A scheduled note counts.
- Until 0.28.0 the header was `X-Note-Created`. A post that still sends it gets `400`, naming `X-Note-Date`.

### Changing the date

A note's date can be changed at any time, also after it is published. Its id, URLs and RSS `guid` stay.

```sh
curl -X PATCH -H "Content-Type: application/json" -d '{"date": "2026-12-01T09:00:00Z"}' "$NOTEFEED_URL/api/v1/feeds/$FEED/notes/$ID"
```

In the web UI it is a field in the compose box (to schedule) and in a note's edit form. The [clients](../integrations/clients.md) take `date` when posting and updating, the CLI `--date`, MCP `post_note` and `edit_note` `date`.

### Polling

A note's id is random: it carries no time and no order, and a date can move into the past. A program that wants new notes asks for the newest page and looks for ids it has not seen before. A scheduled note shows up there when its time comes.

## Editing and deleting notes

All three use the note's API URL, `/api/v1/feeds/<feed>/notes/<id>`, and need what posting needs: the instance password, the feed's own password.

```sh
URL=https://notes.example.com/api/v1/feeds/homelab-7f3k2q9x4m8wz/notes/Vq3xH8mTn2KfLw0aZr9bYe
curl -X PUT -H "Content-Type: text/markdown" --data-binary @note.md "$URL"          # replace the content
curl -X PATCH -H "Content-Type: application/json" -d '{"title": "Backup finished"}' "$URL"   # title, alt text of a picture or date
curl -X DELETE "$URL"                                                                  # gone for good
```

- **The id stays.** A `PUT` keeps the note's id, URLs and date, so its RSS item keeps its `guid`; a reader that already fetched it may keep showing the old text. There is no history.
- **A note keeps its type:** a markdown note takes markdown, a PNG another PNG. A `PUT` with `multipart/form-data` adds [pictures](pictures.md#posting-a-note-with-its-pictures).
- **No undo and no trash.** Anyone who can post to a feed can edit and delete its notes; the read link cannot. Deleting the last note leaves the feed, empty.

## Ids and filenames

A note's id is 22 random characters, such as `Vq3xH8mTn2KfLw0aZr9bYe`: it has no time in it and nothing to read from it, so neither its file name nor its URLs carry its title or its date. The file is `<DATA_DIR>/<feed>/<id>.md` (or `.png`, `.jpg`, `.gif`, `.webp`), with the note's metadata in a small `.json` file next to it.

From 0.28.0 a note's id is random and carries no time. On the first start after the update, existing notes get new ids and keep their dates. Old links to single notes and to files stop working. A note's references to its own feed's files are rewritten; links from one feed into another feed's notes are not. If the main key is in a key service and it is down while this migration is still pending, notefeed does not start.

## Errors

Error responses are JSON, `{"error": "<reason>", "code": "<code>"}`: match on the status or the `code`. Every status and code of every endpoint is in the [REST API](../integrations/api.md). The ones scripts meet most: `401` a missing or wrong password, `402` a [license](../hosted/licenses.md) needed on notefeed.me, `415` a wrong or missing `Content-Type`, `429` too many requests this minute (`Retry-After` says how long to wait), `507` a [cap](../self-hosting/limits.md) is reached.
