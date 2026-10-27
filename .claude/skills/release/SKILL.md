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

After the release:

3. The release notes go onto notefeed.me's `releases` feed (a reserved feed, read link https://notefeed.me/r/releases) by themselves: the `release` job in `ci.yml` posts one note per release (title `notefeed X.Y.Z`, the annotated tag message without its first line under a line with the date and the GitHub release, tags `release` and `vX.Y.Z`) with the repository secret `NOTEFEED_RESERVED_PASSWORD`, and a re-run posts nothing twice. Check https://notefeed.me/r/releases afterwards. When the step was skipped or failed, post it by hand, late rather than not at all, the password read from the server's notefeed settings and never written into a file or commit:

   ```sh
   P=$(cd ../notefeed-ansible && ansible notefeed-1 -m shell -a "grep '^NOTEFEED_RESERVED_PASSWORD=' {{ stacks_dir }}/notefeed/.env | cut -d= -f2-" 2>/dev/null | tail -1)
   git tag -l --format='%(contents)' vX.Y.Z | sed '1{/^notefeed /d}' | sed '/./,$!d' \
     | sed '1i *Released YYYY-MM-DD · [on GitHub](https://github.com/notefeed/notefeed/releases/tag/vX.Y.Z)*\n' \
     | curl -sf -X POST https://notefeed.me/api/v1/feeds/releases/notes -H "Content-Type: text/markdown" \
         -H "X-Feed-Password: $P" -H "X-Note-Title: notefeed X.Y.Z" -H "X-Note-Tags: release,vX.Y.Z" --data-binary @-
   ```

4. CI also writes the short post on notefeed.me's `news` feed (also reserved, https://notefeed.me/r/news): `scripts/release-news.sh` asks Claude (secret `ANTHROPIC_API_KEY`) for a post from the tag message and the release's pull requests, only what users notice, and posts it with tags `release` and `vX.Y.Z` and a link to the release's note; a release with nothing users notice gets none. Check it afterwards: a post can be edited (`PUT`) or deleted on the feed. When the step failed, run it by hand with both secrets in the environment (`DRY_RUN=1` prints the post instead). Other changes worth telling (a change on notefeed.me, a new plan, how something came about) are written by hand in a session: plain words, a few sentences, tags of your choosing, posted to `feeds/news/notes` with the same password.
