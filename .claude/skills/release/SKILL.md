---
name: release
description: Use when cutting a release of notefeed: bumping the client package versions, tagging vX.Y.Z, and what the tag triggers in CI.
---

# Releasing notefeed

A `vX.Y.Z` tag is a release (same tag scheme as the MCP repos).

- `ci.yml` pushes the image as `:X.Y.Z`/`:X.Y`/`:X`/`:latest` and creates the GitHub release. The notes are the annotated tag message, so tag with `git tag -a`, followed by the generated list of pull requests merged since the previous release.
- `ci.yml` also writes two SBOM files (npm dependencies, image) and attaches them to the release; nothing to do by hand.
- `clients.yml` publishes the client packages to PyPI and npm.

Before tagging:

1. Bump `version` to `X.Y.Z` in both `packages/python/pyproject.toml` and `packages/js/package.json`, then `npm version` in `packages/js` (the lockfile) and `uv lock` in `packages/python` (`uv.lock` records the version too; `uv run --locked` in the tests refuses a stale one, and the publish never happens).
2. Commit that on `main`.

The release job refuses a tag that doesn't match both. npm and PyPI refuse a version that is already published, so every release needs a new version.
