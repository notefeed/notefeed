# Upgrading

With the published image:

```sh
docker compose pull && docker compose up -d
```

!!! note "The image moved after 0.9.0"
    Up to and including 0.9.0 the image was published as `ghcr.io/marceltov/notefeed`. That path stays at 0.9.0 and gets no more updates. On the new path, `:latest` and `:main` are there from the first change after 0.9.0, and version tags from the next release on. Change the `image:` line in your compose file to `ghcr.io/notefeed/notefeed` to keep upgrading; nothing else changes.

!!! note "No shell in the image after 0.10.1"
    The image holds Node and the server, and no shell, `wget` or package manager any more. Two things can break on the upgrade: a `healthcheck:` of your own in the compose file that calls `wget` or `curl` (remove its `test:` line, the image's own check does the same; see [Health check](health.md#docker)), and `docker exec <container> sh`. Nothing changes for the data folder, `PUID`/`PGID` or `user:`.

Image tags on `ghcr.io/notefeed/notefeed`:

| Tag | Moves on |
|---|---|
| `:latest` | every release and every change on `main` |
| `:main` | every change on `main` |
| `:X.Y.Z`, `:X.Y`, `:X` | releases (`:0.10` follows the newest 0.10.x) |

To upgrade only on purpose, pin a version, e.g. `image: ghcr.io/notefeed/notefeed:0.10`. Each release is listed on [GitHub Releases](https://github.com/notefeed/notefeed/releases) with its notes.

Built from source:

```sh
git pull && docker compose up -d --build
```

Notes are untouched by upgrades.
