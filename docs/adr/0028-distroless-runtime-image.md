---
status: accepted
date: 2026-10-11
decision-makers: Marcel Bruckner
---

# The runtime image is distroless: Node and nothing to run beside it

## Context and Problem Statement

The image was built on `node:22-alpine`. The first scan for known vulnerabilities (issue #176) found little in notefeed and a lot in the base (issue #178): the npm that the Node image ships, with its own dependency tree (`pacote`, `sigstore`, `brace-expansion`, ...), and an Alpine package (`zlib`) whose fix was in the package repository but in no published Alpine image. notefeed uses none of that at run time: the standalone build needs `node` and the libraries it links against.

The image used the shell in two places: `docker-entrypoint.sh` switched to the owner of `/data` with `su-exec`, and the `HEALTHCHECK` called BusyBox's `wget`.

## Considered Options

* `gcr.io/distroless/nodejs22-debian13`.
* `alpine` with only the `node` binary copied in.
* `node:22-alpine`, with npm removed and `apk upgrade` in the Dockerfile.

## Decision Outcome

Chosen option: distroless. It holds Node, glibc, the C++ runtime, CA certificates and time zone data, and no shell, package manager or npm, so those cannot be findings and cannot be used by someone who got into the container. Patching the Alpine image in the Dockerfile would give the same scan result on the day of the build, but the content of the image would then depend on what the package repository held at build time, and every tool the base adds later would have to be removed by hand. A bare Alpine base has no npm either, but keeps the shell and the package manager, and its `zlib` finding stays until Alpine publishes a new image.

* **The entrypoint is a Node script** (`docker-entrypoint.mjs`). It does what the shell script did: as root, it takes the owner of `/data` (or `PUID`/`PGID`; 1000 where that is root), chowns `/data` itself if needed, drops the groups, sets gid and uid, and then imports `server.js` into the same process. There is no second process and no signal to pass on. Started with `user:`, it switches nothing.
* **The health check is a Node one-liner** in the Dockerfile: `fetch` on `/health`, exit 0 for a 2xx answer.
* **The build stage is Debian too** (`node:22-trixie-slim`), so the build runs on the same libc as the server. `better-sqlite3` brings prebuilt binaries for glibc and musl and picks one at run time.
* **`/data` is created in the build stage** and copied with owner 1000, since the runtime stage cannot run `mkdir`.

### Consequences

* Good, because a scan of the image reports what notefeed brings, not what the base brings.
* Good, because there is less in the container to attack or to misuse.
* Bad, because `docker exec <container> sh` no longer works. To look inside, run a debug container in the same namespaces (`docker debug`, or `docker run --pid container:<name> --network container:<name> busybox`), or read the data folder from the host.
* Bad, because a health check that an operator wrote into their own Compose file with `wget` or `curl` fails after the upgrade; the docs say so (Upgrading).
* Bad, because the base is published by Google under a moving tag: the daily audit is what notices when it falls behind.

### Confirmation

The `image-smoke` job in CI builds the image on every push and pull request, starts it on a folder owned by the runner's user, waits for Docker to report it healthy, posts a note and checks that the note's file belongs to that user.
