# Storage

## Where notes live

Every feed is a folder in `DATA_DIR` (`/data` in the container), and every note a file in it, `<id>.md` or `<id>.png` and so on, exactly as posted, with its metadata in a small `.json` file next to it:

```
data/
├── .secret                        # signs cookies and tokens; back it up
├── homelab-7f3k2q9x4m8wz/
│   ├── .readid                    # the feed's read id; don't edit it by hand
│   ├── .feed.json                 # title, description, title image
│   ├── .password                  # only on a protected feed
│   ├── 20260929T140512Z-backup-finished.md
│   ├── .20260929T140512Z-backup-finished.md.json
│   └── 20261003T101010Z-01a1013e-….png
└── alerts-q9x2m7hd4k1pv/
```

You can read, grep, copy or delete the files directly; a file you put in a feed's folder is a note too. notefeed writes as the owner of the data folder, so create it yourself (`mkdir data`); `PUID` and `PGID` choose another owner. Symlinks and anything that isn't a feed folder are ignored. If you copy a feed's folder to make another feed, remove `.readid` from the copy: two feeds can't share a read link.

A photo keeps its EXIF data, including GPS position, and is public to anyone with the read link: `exiftool -all= photo.jpg` removes it before posting.

## Keeping notes in git

Since the notes are your files, `data` can be a git repository. Keep `.secret`, `.readid` and `.password` out of a public one: with the secret anyone can compute older feeds' read links, `.readid` is a feed's read link, `.password` its password hash.

## Databases

With `NOTEFEED_STORAGE` notefeed keeps everything in a database instead: `sqlite` (one file) or `postgres` (a server, which several notefeed containers can share). The API, the read links and the web UI are the same.

| | `fs` (default) | `sqlite` | `postgres` |
|---|---|---|---|
| Where | folders in `DATA_DIR` | one file, `NOTEFEED_DATABASE_URL` (default `DATA_DIR/notefeed.db`) | a PostgreSQL server, `NOTEFEED_DATABASE_URL` |
| `NOTEFEED_SECRET` | optional | required | required |
| Containers | one | one | several, with the same secret |
| Back up with | copy the folder | `sqlite3 notefeed.db ".backup out.db"` | `pg_dump` |

The tables are created, and updated on upgrade, when notefeed starts. With a database there is no hand-editing of files, and moving an existing `data` folder into a database is not built in: a new instance on a database starts empty.

### PostgreSQL

```yaml
services:
  notefeed:
    image: ghcr.io/notefeed/notefeed:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      NOTEFEED_STORAGE: postgres
      NOTEFEED_DATABASE_URL: postgres://notefeed:${POSTGRES_PASSWORD}@db:5432/notefeed
      NOTEFEED_SECRET: ${NOTEFEED_SECRET}      # openssl rand -hex 32
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: notefeed
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: notefeed
    volumes:
      - notefeed-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U notefeed"]
      interval: 5s
      retries: 10

volumes:
  notefeed-db:
```

Put `POSTGRES_PASSWORD` and `NOTEFEED_SECRET` in a `.env` file next to it, then `docker compose up -d`. A password with `@` or `/` in the URL must be percent-encoded. Back up with `docker compose exec db pg_dump -U notefeed notefeed > notefeed.sql`, and keep the secret with it.

## Image bytes outside the database

With a database backend, `NOTEFEED_IMAGES` says where the bytes of image notes go; everything else stays in the database, and images are still served by notefeed under the read link.

| `NOTEFEED_IMAGES` | Where the bytes are | Use it when |
|---|---|---|
| `db` (default) | in the note's row | the instance is small; one thing to back up |
| `fs` | one file per image in `NOTEFEED_IMAGES_DIR` | one container with many images |
| `s3` | one object per image in a bucket | several containers, which must all reach every image |

### An S3-compatible object store

Any store that speaks S3 works, hosted (Hetzner, Scaleway, Cloudflare R2, AWS) or your own (MinIO, Garage). Create a private bucket and a key that may read, write and delete in it; objects are named by a random key, so the bucket shows neither feed names nor note ids.

```yaml
environment:
  NOTEFEED_STORAGE: postgres
  NOTEFEED_IMAGES: s3
  NOTEFEED_S3_ENDPOINT: https://s3.example.com
  NOTEFEED_S3_BUCKET: notefeed-images
  NOTEFEED_S3_REGION: us-east-1
  NOTEFEED_S3_ACCESS_KEY: <access key>
  NOTEFEED_S3_SECRET_KEY: <secret key>
```

If the store is unreachable, pictures fail and text notes keep working. Going from `db` to `fs` or `s3` works at any time: old images stay where they are and are still served. Going between `fs` and `s3` strands the old images until they are [moved](#moving-images-between-stores).

## Encryption at rest

With `NOTEFEED_ENCRYPTION_KEY` set, notefeed encrypts what it stores before it reaches the database or the image store, so a copy of either, a dump or a snapshot of the disk can't be read without the key. Each feed has its own data key: its notes, images, metadata, settings and feed password are encrypted with it (AES-256-GCM). The data keys are stored next to their feeds, encrypted with the main key, which is never stored. Feed names and read ids are stored only as fingerprints, so the database doesn't hand anyone a way into a feed. The database's own housekeeping stays readable: ids, sizes and times.

It needs a database backend; on the file system backend notefeed refuses to start with a key. While notefeed runs, it holds the key, so encryption at rest doesn't protect against someone on the running server.

```sh
openssl rand -hex 32   # the main key
```

**Keep the key safe and apart from the backups.** Without it nothing can be read back, by anyone. notefeed refuses to start on an encrypted database without the key, or with another key.

### Turning it on for existing data

Set the key and restart. At start, notefeed gives every feed its data key and stores names and read ids as fingerprints. With several containers, stop them all and start them all with the key: one still running without it would write plain rows next to the encrypted ones, and the next start refuses such a database. Notes stored before stay readable, and are encrypted with `POST /api/operator/reseal`, a batch at a time, while notefeed serves:

```sh
curl -X POST -H "Authorization: Bearer $NOTEFEED_OPERATOR_TOKEN" -H "Content-Type: application/json" \
  -d '{"limit": 500}' https://notes.example.com/api/operator/reseal
```

It answers `resealed`, `skipped` (notes that changed meanwhile, or whose image is missing), `failed`, `left` and a `next` cursor to send as `"after"` until it is `null`. A call without a body takes the defaults. Notes that were `skipped` or `failed` stay plain; run it again from the start (without `"after"`) until a run reseals nothing and nothing is `left`. It is safe to stop at any point: an image's encrypted copy is written first and the plain one removed last.

### Changing the main key

Put the new key in `NOTEFEED_ENCRYPTION_KEY`, the old one in `NOTEFEED_ENCRYPTION_OLD_KEYS`, and restart. At start, notefeed wraps every data key again under the new key; no note or image is touched, so this takes seconds however much is stored. Then remove the old key. With several containers, restart them all together: one still on the old key can't open what the others re-wrapped.

### Cleaning up the image store

An image is written before its note and deleted after it, so a stop in between leaves a file or object no note refers to. With `NOTEFEED_OPERATOR_TOKEN` set, the operator's endpoint finds and removes them:

```sh
# Report only
curl -H "Authorization: Bearer $NOTEFEED_OPERATOR_TOKEN" https://notes.example.com/api/operator/images/unreferenced
# Report and remove
curl -X DELETE -H "Authorization: Bearer $NOTEFEED_OPERATOR_TOKEN" https://notes.example.com/api/operator/images/unreferenced
```

The answer counts what is `unreferenced` (older than an hour), `deleted`, `failed`, `too_recent` and `missing` (notes whose bytes are gone; they show as broken images). It reads the whole listing, so run it occasionally, as a daily cron. Only names that look like notefeed's image keys are touched; one bucket per instance, or two instances delete each other's images. With [metrics](operating.md#metrics) on, each run updates the `notefeed_images_*` gauges.

### Moving images between stores

`POST /api/operator/images/move` moves image bytes into the store `NOTEFEED_IMAGES` names now, from wherever they are. Set the new store, restart, then:

```sh
curl -X POST -H "Authorization: Bearer $NOTEFEED_OPERATOR_TOKEN" -H "Content-Type: application/json" \
  -d '{"from": "db"}' https://notes.example.com/api/operator/images/move
# from a folder: {"from": "fs", "dir": "/data/images"}
# from a bucket: {"from": "s3", "endpoint": "…", "bucket": "…", "access_key": "…", "secret_key": "…"}
```

One call moves `limit` notes (100 by default) and answers `moved`, `skipped`, `missing`, `failed`, `left` and a `next` cursor to send as `"after"` until it is `null`. It is safe to stop at any point: each image is copied first and the old bytes removed last. Posting goes on meanwhile.
