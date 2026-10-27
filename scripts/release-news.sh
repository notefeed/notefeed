#!/usr/bin/env bash
# Writes the short post for notefeed.me's news (https://notefeed.me/r/news) about one release, with the Claude API, and posts it.
# Usage: scripts/release-news.sh vX.Y.Z   (env: ANTHROPIC_API_KEY, NOTEFEED_RESERVED_PASSWORD; DRY_RUN=1 prints the post instead)
# Run by the release job in ci.yml after the release's note is on /r/releases. What it reads: the annotated tag message and the
# pull requests merged since the previous tag (title and description); the last news posts, for the tone. Only what users
# notice goes in; a release with nothing of the kind gets no post. A release that already has a post (tag vX.Y.Z) gets no second one.
set -euo pipefail
TAG=${1:?usage: release-news.sh vX.Y.Z}
API=https://notefeed.me/api/v1
REPO=${GITHUB_REPOSITORY:-notefeed/notefeed}

if [ "$(curl -sf "$API/read/news/notes?tag=$TAG" | jq '.notes | length')" != 0 ]; then echo "already in the news"; exit 0; fi
note=$(curl -sf "$API/read/releases/notes?tag=$TAG" | jq -r '.notes[0].id // empty')
[ -n "$note" ] || { echo "::error::$TAG has no note on /r/releases yet"; exit 1; }

prev=$(git describe --tags --abbrev=0 --match 'v*' "$TAG^" 2>/dev/null || true)
notes=$(git for-each-ref "refs/tags/$TAG" --format='%(contents)')
prs=""
for n in $(git log --merges --format=%s "${prev:+$prev..}$TAG" | sed -n 's/^Merge pull request #\([0-9]*\).*/\1/p'); do
  prs+=$(gh pr view "$n" -R "$REPO" --json number,title,body -q '"## #\(.number): \(.title)\n\n\(.body)\n\n"')
done
recent=$(curl -sf "$API/read/news/notes?limit=3" | jq -r '.notes[] | "## \(.title)\n\n\(.content)\n"')

system='You write the news of notefeed.me, a small hosted service (and open-source app) for posting markdown notes and pictures to feeds that people read in the browser or by RSS, from scripts, the web, or AI assistants. The news tells the people who use notefeed what changed for them.

For a release, write one short post:
- Only what a user of notefeed or notefeed.me notices: features, changed behavior, fixes they would have run into, new limits or prices, client package changes they use. Leave out tests, refactors, CI, internal docs, ADR numbers, PR numbers, code names.
- Plain words, no marketing, no exclamation marks, no emojis. Say what it does for the reader, not how it is built.
- A sentence saying the version is out, then at most four short bullet points or two short paragraphs. Markdown, no heading (the title is separate).
- The title: "notefeed X.Y.Z: " and what matters most in a few words, lowercase after the colon.
- Do not add links to the release notes: they are appended after your text.
- If nothing in the release is noticeable for users, set post to false and leave title and markdown empty.
Match the tone of the earlier posts, if there are any.'

# As files, not arguments: one argument may not exceed 128 KB, and the pull requests of a large release do (0.29.0).
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
printf '%s' "$system" > "$tmp/system"
printf 'Release %s\n\n# Release notes (the tag message)\n\n%s\n\n# Pull requests in this release\n\n%s\n\n# Earlier news posts\n\n%s\n' "$TAG" "$notes" "$prs" "${recent:-(none yet)}" > "$tmp/user"

body=$(jq -n --rawfile system "$tmp/system" --rawfile user "$tmp/user" '{
  model: "claude-opus-5-5", max_tokens: 16000, fallbacks: "default", system: $system,
  messages: [{role: "user", content: $user}],
  output_config: {format: {type: "json_schema", schema: {type: "object", additionalProperties: false, required: ["post", "title", "markdown"],
    properties: {post: {type: "boolean"}, title: {type: "string"}, markdown: {type: "string"}}}}}
}')
res=$(curl -sS --fail-with-body https://api.anthropic.com/v1/messages -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: server-side-fallback-2026-07-01" -H "content-type: application/json" --data-binary @- <<< "$body")
stop=$(jq -r .stop_reason <<< "$res")
[ "$stop" = end_turn ] || { echo "::error::the Claude API stopped with $stop"; exit 1; }
out=$(jq -r '[.content[] | select(.type == "text") | .text] | join("")' <<< "$res")

if [ "$(jq -r .post <<< "$out")" != true ]; then echo "nothing users notice in $TAG: no post"; exit 0; fi
title=$(jq -r .title <<< "$out")
text=$(jq -r .markdown <<< "$out")
text+=$(printf '\n\nAll the details are in the [release notes](https://notefeed.me/r/releases/%s) and [on GitHub](https://github.com/%s/releases/tag/%s).\n' "$note" "$REPO" "$TAG")

if [ -n "${DRY_RUN:-}" ]; then printf '# %s\n\n%s\n' "$title" "$text"; exit 0; fi
# The title goes as its UTF-8 bytes, which is how the server reads a header.
printf '%s' "$text" | curl -sf -X POST "$API/feeds/news/notes" -H "Content-Type: text/markdown" -H "X-Feed-Password: $NOTEFEED_RESERVED_PASSWORD" \
  -H "X-Note-Title: $title" -H "X-Note-Tags: release,$TAG" --data-binary @- | jq -r '"posted: https://notefeed.me/r/news/\(.id)"'
