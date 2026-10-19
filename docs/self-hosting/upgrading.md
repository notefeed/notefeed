# Upgrading

With the published image:

```sh
docker compose pull && docker compose up -d
```

Notes are untouched by upgrades. Image tags on `ghcr.io/notefeed/notefeed`:

| Tag | Moves on |
|---|---|
| `:latest` | every release and every change on `main` |
| `:main` | every change on `main` |
| `:X.Y.Z`, `:X.Y`, `:X` | releases (`:0.10` follows the newest 0.10.x) |

To upgrade only on purpose, pin a version. Each release is listed on [GitHub Releases](https://github.com/notefeed/notefeed/releases) with its notes.

!!! warning "From 0.19 to 0.20: the pages folder"
    `NOTEFEED_IMPRINT_FILE`, `NOTEFEED_PRIVACY_FILE`, `NOTEFEED_TERMS_FILE` and `NOTEFEED_NOTICE_FILE` are no longer read. Put the files in one folder as `imprint.md`, `privacy.md`, `terms.md` and `notice.md`, mount it, and set `NOTEFEED_PAGES_DIR` to it (see [Imprint, privacy page and terms](legal-pages.md)). Until then those pages are gone; the startup log names each old setting that is still set.

!!! note "Older set-ups"
    Up to 0.9.0 the image was `ghcr.io/marceltov/notefeed`; change the `image:` line to keep upgrading. Since 0.10.1 the image has no shell: remove a `healthcheck:` of your own that calls `wget` or `curl`, the image's own check does the same (see [Health check](operating.md#docker)).

## Running from source

```sh
npm ci
DATA_DIR=./data npm run dev          # http://localhost:3000
npm test && npm run lint && npm run typecheck
```

Built from source in Docker, upgrade with `git pull && docker compose up -d --build`.

## Security fixes and SBOM

Only the newest release gets security fixes; an instance on `:latest` or a tag that follows the newest release gets them with the next pull. Report a vulnerability privately through [Report a vulnerability](https://github.com/notefeed/notefeed/security/advisories/new) on GitHub; fixed ones are listed under [Security advisories](https://github.com/notefeed/notefeed/security/advisories).

Each release carries two SBOM files in CycloneDX JSON, `notefeed-X.Y.Z-npm.cdx.json` (the npm packages the server is built from) and `notefeed-X.Y.Z-image.cdx.json` (what a scan finds in the image), and the image has an SBOM and a provenance attestation (`docker buildx imagetools inspect … --format '{{ json .SBOM }}'`). To scan the image yourself: `grype ghcr.io/notefeed/notefeed:latest --only-fixed`. The project runs the same scan daily.
