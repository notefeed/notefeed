# Deleting notes and feeds

A feed's owner deletes it from the web UI or the [API](../using/feeds.md#feed-settings-in-the-api): the notes, the images, the settings, the password and the read link go, and the name is free again. [Reserved feeds](access.md#reserved-feeds) come back, empty and with the same read link, at the next start.

With file storage you can also delete a note's file, or a feed's whole folder, by hand; it disappears at once. A feed removed by hand is still listed as empty until a restart.

```sh
rm data/homelab-7f3k2q9x4m8wz/Vq3xH8mTn2KfLw0aZr9bYe.md
rm -r data/homelab-7f3k2q9x4m8wz
```

Two things can go wrong with a feed's files. If a feed's first note fails to save (a full disk, say), an empty, open feed may be left: delete it and create it again, or give it a password ([a password for an open feed](../using/feed-passwords.md#a-password-for-an-open-feed)). If notefeed can't read a feed's `.readid` at start-up, it logs that and lists the feed without a read link (`read_url` is `null`) until the file is readable and notefeed restarted.

## Removing a feed as the operator

When reported content must go, the operator has a read link or an image URL from the [report](legal-pages.md#a-report-link-on-every-published-note), not the feed's name. With `NOTEFEED_OPERATOR_TOKEN` set, `POST /api/operator/takedown` takes any of them and removes the feed for good:

```sh
curl -X POST -H "Authorization: Bearer $NOTEFEED_OPERATOR_TOKEN" -H "Content-Type: application/json" \
  -d '{"target": "https://notes.example.com/r/q2Zc9kD0bTnVx4LmAe7sWp/Qw8nR2dLm5XaTc1VbJ7kUe.png"}' \
  https://notes.example.com/api/operator/takedown
```

What happens:

1. **A tombstone** is written for the feed's name and read id. From then on the feed page, the read-only view, the RSS feed and posting to the name answer *removed by the operator* (`410`), and neither can ever be used again, not even by the operator.
2. **The notes and the image bytes go**, from the database or the folder and from the image store. The answer names the removed `image_keys`, for the purge of backups.
3. **The images' hashes** go on the instance's blocklist: the same bytes are refused with `451` (`blocked`) in every feed from then on.

The log says that a feed was removed and how much went, never which one or who reported it. Tombstones and the blocklist are data, in the database or in `DATA_DIR/.tombstones` and `.blocklist`, so a restore from before the takedown brings the feed back: run the takedown again then. Backups made before still hold the content; what to do with them is the operator's procedure.

## Removing one post as the operator

When the rest of the feed is fine, the smaller measure removes only the reported post ([ADR 0052](../adr/0052-the-operator-takes-down-one-post.md)): with `"scope": "note"`, the target is the note's read URL (`/r/<read id>/<note id>`, from the report's read id and note id), an image URL, or `<read id>/<note id>`.

```sh
curl -X POST -H "Authorization: Bearer $NOTEFEED_OPERATOR_TOKEN" -H "Content-Type: application/json" \
  -d '{"target": "https://notes.example.com/r/q2Zc9kD0bTnVx4LmAe7sWp/Qw8nR2dLm5XaTc1VbJ7kUe", "scope": "note"}' \
  https://notes.example.com/api/operator/takedown
```

What goes is the post: the note named, the text note it was posted with if it is an attachment, and every attachment of that text. A note that merely shows one of its images in its own text stays; the image answers `410` there. When more of the feed looks connected than one post, remove the feed (above).

1. **The images' hashes** go on the blocklist, as for a feed.
2. **A tombstone** is written for each removed note's id in its feed. From then on its file and the API answer *removed by the operator* (`410`, `removed`), and its page says so, for good.
3. **The notes and their image bytes go**; the answer lists the removed note ids (`notes`) and the `image_keys`, for the purge of backups, and never the feed's name.
4. **A mark** takes the post's place, with its date: *Removed by the operator: this broke the content rules of this instance.*, linked to the terms page when there is one. Readers see it in the list and in RSS; a client sees a note with `removed: true`. The owner can delete the mark like any note; the post does not come back.

A takedown of the same post again answers `already_removed`, or, if the first one was cut short, removes what of the post is left. The note tombstones are data of the feed (a table in the database, `.removed-notes` in the feed's folder) and go when the feed goes.
