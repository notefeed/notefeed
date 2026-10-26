---
status: accepted
date: 2026-10-26
decision-makers: Marcel Bruckner
---

# The read link serves the newest note of a name

## Context and Problem Statement

Every note's file is served at `/r/<read id>/<id>.<ext>`, an address that changes with every new note, so it can't be linked as "the current version of this file": a skill that CI posts on each release, a picture in a README, a blog's slug (#250). A note already keeps a `name` (`X-Note-Name`, so far the original name of a picture).

## Considered Options

* A separate "file" kind with its own store and versions.
* **The name a note already has, looked up at read time** (chosen).
* A unique name per feed, replaced in place by a new post.

## Decision Outcome

Chosen: the existing `name`, looked up at read time.

* `/r/<read id>/<name>` (any name the rewrite to the file route takes: one path segment ending in a lower-case extension) serves the newest note of the feed with that name, dated now or earlier, as its own file would be served (type from the note, ETag, `private, no-cache`). A note's own file name comes first, so a name never takes another note's address; ids are random, so a clash is only ever deliberate, and it loses.
* Names are not unique: posting again under a name is a new version, the earlier ones stay as history at their own addresses, and deleting the newest brings back the one before. An edit keeps the name.
* `name` on post: the `X-Note-Name` header for any note (it was described for pictures only), `name` in the clients (they had it) and in MCP `post_note`.
* The lookup reads sidecars newest first until one matches, as a rare tag does; a name index is the fix if feeds get large.

### Consequences

* Good, because a stable link to a changing file needs nothing new in storage, and the history is the feed itself.
* Neutral: markdown is served as `text/plain`, like every note's file, so a browser shows it; the issue suggested `text/markdown`.
* Not done here: a reserved `skills` feed on notefeed.me and the CI step that fills it; the API's note JSON has no field for the address by name.
