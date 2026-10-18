# Backups

Back up the `data` folder, including `.secret` and the dot files inside each feed folder: `.readid`, `.feed.json` and `.password`. Restoring the files restores the notes, the settings and the passwords. A backup that skips hidden files loses them: a feed without its `.readid` gets another read link, a feed without its `.password` is open. Restart notefeed after restoring.

```sh
tar czf notefeed-notes.tgz -C data .
```

With a [database](storage.md#databases), back up the database instead (`pg_dump`, or the SQLite file) and keep `NOTEFEED_SECRET` with it: it is not in the database. With [encryption at rest](storage.md#encryption-at-rest), keep `NOTEFEED_ENCRYPTION_KEY` too, but not in the same place as the backups: a backup and its key together can be read by whoever has both, and a backup without its key can be read by nobody. With [image bytes outside the database](storage.md#image-bytes-outside-the-database), back up the folder or the bucket as well, after the database: an image without its note is only an unused file, while a note without its image shows as broken.

## How long a backup keeps what was deleted

A backup still holds every feed and note deleted after it was made, so how long you keep backups is how long deleted notes live on. The times add up when one backup holds another: database dumps kept 1 day on a server whose disk is backed up for 7 days are 8 days. On a public instance, say that number on your [privacy page](legal-pages.md#what-to-write).
