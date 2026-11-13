# On your own server

Your own instance keeps the notes on your disk and has no free tier: every feature is on, and the limits are [yours to set](../self-hosting/configuration.md). To post without installing anything, use [notefeed.me](notefeed-me.md) instead.

You need Docker with Compose. No checkout, no build: the image is published at `ghcr.io/notefeed/notefeed`.

**1. Create a folder with this `compose.yaml`:**

```yaml
services:
  notefeed:
    image: ghcr.io/notefeed/notefeed:latest  # or pin a release, e.g. :0.35
    restart: unless-stopped
    ports:
      - "3000:3000"
    env_file: .env    # every setting, see step 2
    volumes:
      - ./data:/data  # your notes, as plain .md files
```

**2. Put the settings next to it.** [`.env.example`](https://github.com/notefeed/notefeed/blob/main/.env.example) lists every setting, commented out, with its default; an unchanged copy runs notefeed as it ships. Set `TZ` for the web UI's times, and on a public instance `PUBLIC_URL` and perhaps `NOTEFEED_PASSWORD` (see [Configuration](../self-hosting/configuration.md)):

```sh
curl -fsSLo .env https://raw.githubusercontent.com/notefeed/notefeed/main/.env.example
```

**3. Create the data folder, then start it:**

```sh
mkdir data   # notefeed writes notes as the owner of this folder, so they're yours
docker compose up -d
```

Your notes are plain files in `data`, one folder per feed, owned by you: read them, grep them, or commit them to git (see [Storage](../self-hosting/storage.md#keeping-notes-in-git)).

**4. Open <http://localhost:3000>**, pick a feed name (it suggests a random one), and write a note. Or post your first note from a shell:

```sh
curl -H "Content-Type: text/markdown" --data-binary $'# Hello\nMy first note.' http://localhost:3000/homelab-7f3k2q9x4m8wz
```

The answer holds the feed's `read_url`. Add it to any feed reader.

**Next:** [Concepts](concepts.md) explains feeds, names and read links. For a public instance, see [Configuration](../self-hosting/configuration.md), a [reverse proxy](../self-hosting/reverse-proxy.md) and [Passwords and access](../self-hosting/access.md); the rest of [Self-hosting](../self-hosting/configuration.md) covers storage, backups, metrics and upgrading.
