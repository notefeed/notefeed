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

1. Bump `version` to `X.Y.Z` in `packages/python/pyproject.toml`, `packages/js/package.json` and `server.json` (the MCP server for registries; a test keeps it equal to the JS package), then `npm version` in `packages/js` (the lockfile) and `uv lock` in `packages/python` (`uv.lock` records the version too; `uv run --locked` in the tests refuses a stale one, and the publish never happens).
2. Commit that on `main`.

The release job refuses a tag that doesn't match both. npm and PyPI refuse a version that is already published, so every release needs a new version.

The tag message is the release notes: on GitHub, on /r/releases, and what the news post is written from. Its shape:

- First line `notefeed X.Y.Z` (dropped on /r/releases), then what changed for users in a few short paragraphs, as the previous tags do.
- `Breaking:` a paragraph per change that makes something stop working (a renamed or removed header, parameter, tool or command, something now refused, a changed default) and what to do instead. Check every pull request since the last tag for one; when there is none, leave the paragraph out.
- `Upgrading:` what someone who runs notefeed has to do: a new or changed setting (and that notefeed.me sets it in MarcelBruckner-Business/ansible), a backup before a migration.
- `MCP:` when the tools changed (`git diff --quiet vPREV..HEAD -- backend/mcp.ts` fails): which tools or parameters are new, changed or gone, and that assistants see them only after reconnecting (Claude: a new chat, or remove and add the connector; Claude Code: restart). When the sign-in changed (`backend/oauth`, `app/.well-known`, `app/mcp`) in a way that ends existing connections: connect notefeed again.

Write the message to a file and tag with `git tag -a vX.Y.Z -F <file>`.

After the release:

3. The release goes onto notefeed.me's `releases` feed (a reserved feed, read link https://notefeed.me/r/releases) by itself, as a copy of the GitHub release: the `release` job in `ci.yml` posts its text as GitHub shows it (the tag message, "What's Changed" with every pull request merged since the previous release, the install section) and a link to it, as one note (title `notefeed X.Y.Z`, tags `release`, `notefeed` and `notefeed-vX.Y.Z`, as the engineering conventions ask of every tool), with the repository secret `NOTEFEED_RESERVED_PASSWORD`; a re-run posts nothing twice. freundebuch and passageway post theirs the same way. Check https://notefeed.me/r/releases afterwards. When the step was skipped or failed, post it by hand, late rather than not at all, the password read from the server's notefeed settings and never written into a file or commit:

   ```sh
   P=$(cd ../rename/ansible && ansible products-1 -m shell -a "grep '^NOTEFEED_RESERVED_PASSWORD=' {{ stacks_root }}/notefeed/notefeed/.env | cut -d= -f2-" 2>/dev/null | tail -1)
   gh release view vX.Y.Z --json body,url --jq '.body + "\n\n[The release on GitHub](" + .url + ")\n"' \
     | curl -sf -X POST https://notefeed.me/api/v1/feeds/releases/notes -H "Content-Type: text/markdown" \
         -H "X-Feed-Password: $P" -H "X-Note-Title: notefeed X.Y.Z" -H "X-Note-Tags: release,notefeed,notefeed-vX.Y.Z" --data-binary @-
   ```

4. The same job posts each agent skill, `plugin/skills/<name>/SKILL.md`, to notefeed.me's reserved `skills` feed under the name `<name>.md` (title `<name> (notefeed X.Y.Z)`, tags `skill`, `<name>`, `vX.Y.Z`), so https://notefeed.me/r/skills/<name>.md is always the newest; a re-run posts nothing twice, and before the feed exists the step only leaves a notice. Check https://notefeed.me/r/skills/post-to-notefeed.md afterwards; by hand, the same `curl` as for the releases feed with `X-Note-Name: <name>.md` and the file as the body.

5. CI also writes the short post on notefeed.me's `news` feed (also reserved, https://notefeed.me/r/news): `scripts/release-news.sh` asks Claude (secret `ANTHROPIC_API_KEY`) for a post from the tag message and the release's pull requests, written from the user's side (what changes for them, in a few short paragraphs, not a list of changes: that is the releases feed), and posts it with tags `release` and `vX.Y.Z` and a link to the release's note; a release with nothing users notice gets none. Check it afterwards: a post can be edited (`PUT`) or deleted on the feed. When the step failed, run it by hand with both secrets in the environment (`DRY_RUN=1` prints the post instead). Other changes worth telling (a change on notefeed.me, a new plan, how something came about) are written by hand in a session: plain words, a few sentences, tags of your choosing, posted to `feeds/news/notes` with the same password.
