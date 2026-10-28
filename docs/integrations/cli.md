# Command line

The command takes its settings from flags, or else from these environment variables:

| Flag | Variable | Meaning |
|---|---|---|
| `--url` | `NOTEFEED_URL` | notefeed's base URL, e.g. `https://notes.example.com` |
| `--feed` | `NOTEFEED_FEED` | the feed |
| `--password` | `NOTEFEED_PASSWORD` | the instance password (`NOTEFEED_PASSWORD` on the server), only if it has one |

A feed's own password is read from `NOTEFEED_FEED_PASSWORD`, and has no flag at all. Prefer the environment variables for the passwords and the feed name: flag values are visible to other users of the machine in the process list.

```sh
export NOTEFEED_URL=https://notes.example.com NOTEFEED_FEED=homelab-7f3k2q9x4m8wz
notefeed post "# Backup finished"          # the text as an argument
backup.sh 2>&1 | notefeed post -           # from stdin
notefeed post --file report.md             # from a file
notefeed post "# Deployed" --tag ci --tag deploy   # with tags
notefeed post "# Disk at 91%" --feed alerts-q9x2m7hd4k1pv
notefeed edit Vq3xH8mTn2KfLw0aZr9bYe "# Backup finished, verified"
notefeed edit Vq3xH8mTn2KfLw0aZr9bYe --file report.md   # or "-" for stdin
notefeed delete Vq3xH8mTn2KfLw0aZr9bYe
notefeed post --file photo.png --title Cat # a picture is a note too (the type comes from the extension)
notefeed post "Result: ![](chart.png)" --attach out/chart.png   # a note with its pictures, in one request
notefeed post --attach out/a.png --attach out/b.png   # only pictures, no text
notefeed update Vq3xH8mTn2KfLw0aZr9bYe --title "Backup" --alt "…"
notefeed post "# Old entry" --date 2025-03-01   # dated in the past; a future date schedules the note
notefeed update Vq3xH8mTn2KfLw0aZr9bYe --date 2026-12-01T09:00:00+01:00   # move a note
notefeed post "# Not yet" --draft             # a draft: readers don't see it
notefeed update Vq3xH8mTn2KfLw0aZr9bYe --publish   # publish it at its date (--draft hides it again)
notefeed notes                             # the newest 20: time, title, URL
notefeed notes --limit 100 --json          # one JSON object per line
notefeed notes --tag ci                     # only notes with this tag
notefeed --version
```

Text that starts with `-`, like a list item, works as-is: `notefeed post "- buy milk"`. The usual `notefeed post -- "-x"` works too.

`post` prints the new note's URL, `edit` the edited note's, `delete` nothing. `--file PATH` sends the file as it is, with the type its extension says or `--type`. `--attach PATH` (repeatable) posts pictures [with the note](../using/pictures.md#posting-a-note-with-its-pictures) in one request; the text refers to them by the file's own name. Anyone who can post to a feed can edit and delete its notes, and a delete cannot be undone. On failure the command prints `notefeed: <reason>` to stderr and exits with:

| Exit code | Meaning |
|---|---|
| `0` | Done |
| `1` | The server refused (including a wrong password, a rate limit or a full cap), or couldn't be reached |
| `2` | Usage or configuration problem: no text or file, an unreadable file, no URL or feed, an invalid feed name |

## From a script

A backup job that reports how it went. `NOTEFEED_URL` and `NOTEFEED_FEED` come from the environment:

```sh
#!/usr/bin/env bash
set -euo pipefail

if output=$(restic backup /srv 2>&1); then status="finished"; else status="FAILED"; fi

printf '# Backup %s on %s\n\n```\n%s\n```\n' "$status" "$(hostname)" "$(tail -n 5 <<<"$output")" |
  notefeed post - > /dev/null
```

With plain curl, replace the last line with:

```sh
  curl -fsS -H "Content-Type: text/markdown" --data-binary @- "$NOTEFEED_URL/$NOTEFEED_FEED" > /dev/null
```

From a program, the [client libraries](clients.md) do the same.
