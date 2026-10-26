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

## Posting in the past

A note is dated when it is posted. To post one that was written earlier, an old changelog entry for example, send `X-Note-Created`:

```sh
curl -H "Content-Type: text/markdown" -H "X-Note-Created: 2025-03-01T09:30:00+01:00" --data-binary @note.md "$NOTEFEED_URL/$FEED"
```

- An ISO 8601 date and time with its offset (`Z`, `+01:00`), or a date alone, which is midnight UTC.
- From 1970 to now: a time in the future is refused (`400`).
- The note takes its place in the feed, the read link and RSS by that time, as if it had been posted then. On a multipart post every note gets it, the pictures before the text.
- A program that asks for the notes after the last one it has seen does not see a note posted in the past.
- On a feed with a free note cap, a note older than the ones kept is the first to go.

## Editing and deleting notes

All three use the note's API URL, `/api/v1/feeds/<feed>/notes/<id>`, and need what posting needs: the instance password, the feed's own password.

```sh
URL=https://notes.example.com/api/v1/feeds/homelab-7f3k2q9x4m8wz/notes/20260929T140512Z-backup-finished
curl -X PUT -H "Content-Type: text/markdown" --data-binary @note.md "$URL"          # replace the content
curl -X PATCH -H "Content-Type: application/json" -d '{"title": "Backup finished"}' "$URL"   # title, or alt text of a picture
curl -X DELETE "$URL"                                                                  # gone for good
```

- **The id stays.** A `PUT` keeps the note's id, URLs and time, so its RSS item keeps its `guid`; a reader that already fetched it may keep showing the old text. There is no history.
- **A note keeps its type:** a markdown note takes markdown, a PNG another PNG. A `PUT` with `multipart/form-data` adds [pictures](pictures.md#posting-a-note-with-its-pictures).
- **No undo and no trash.** Anyone who can post to a feed can edit and delete its notes; the read link cannot. Deleting the last note leaves the feed, empty.

## Ids and filenames

A note's id is the UTC time to the second plus a random UUID, such as `20261002T091400Z-3f2b8c1e-7d4a-4e6b-9a15-c0d2e8f41b73`, so neither its file name nor its URLs carry its title. The file is `<DATA_DIR>/<feed>/<id>.md` (or `.png`, `.jpg`, `.gif`, `.webp`), with the note's metadata in a small `.json` file next to it.

## Errors

Error responses are JSON, `{"error": "<reason>", "code": "<code>"}`: match on the status or the `code`. Every status and code of every endpoint is in the [REST API](../integrations/api.md). The ones scripts meet most: `401` a missing or wrong password, `402` a [license](../hosted/licenses.md) needed on notefeed.me, `415` a wrong or missing `Content-Type`, `429` too many requests this minute (`Retry-After` says how long to wait), `507` a [cap](../self-hosting/limits.md) is reached.
