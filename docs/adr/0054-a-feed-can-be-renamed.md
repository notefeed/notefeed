---
status: accepted
date: 2026-11-12
decision-makers: Marcel Bruckner
---

# A feed can be renamed; the old name is freed

## Context and Problem Statement

ADR 0016 fixed a feed's name and let only its read id change. A feed then stays stuck with a name it no longer should have: the 3D Bruckner feed got the read link `3dbruckner` but kept the name `3d-bruckner`, and the only way out was a new feed and every note moved by hand (#350). ADR 0016 had kept the name fixed because renaming moves the feed's directory, changes its unlock cookie and needs every name rule twice. Should a feed's name change, and what happens to the old one?

## Decision Drivers

* Everything stays with the feed: notes and drafts, files, settings, password, license and read link (V8). Readers notice nothing.
* The same in the REST API, both clients, MCP and the web UI (V11).
* The same on every storage backend, encrypted or not (ADR 0023, ADR 0033), as one change that is done or not at all.
* notefeed keeps no record about a feed beyond what it holds (V2): no list of former names.

## Considered Options

* Keep the name fixed (ADR 0016).
* A rename that retires the old name: it answers `404` for good and can't be created again, from a record of retired names.
* A rename that frees the old name, as a read id change frees the old id (chosen).

## Decision Outcome

Chosen: free the old name. `PUT /api/v1/feeds/{feed}` takes `name`, as do MCP `update_feed`, the clients' `update_feed` / `updateFeed` and a **Rename this feed** row in the settings page's danger zone. The rename comes last in the request, after the other settings are saved under the old name, and the answer is the feed under its new name.

* **The new name** follows the feed name rule and must be free: not another feed's, not a removed feed's (a tombstone), not a route's, not a reserved feed's (`409`, code `taken`, as a taken read id). A reserved feed keeps its name (`400`).
* **The old name is freed.** Nothing is recorded; it answers like any unused name, and a post to it creates a new, empty feed.
* **Storage** (`Storage.renameFeed`, in the contract suite):
  - On the file system, the feed's directory is renamed in one `rename()`, in the same queue as read id changes. A feed whose read id is derived from its name (from before `.readid`) has that id written to `.readid` first, so its read link stays.
  - On SQLite and PostgreSQL, one transaction: the old row's read id is parked, a row under the new name takes every value, the notes and the operator's note marks move to it, and the old row goes.
  - Encrypted, the feed's data key is wrapped again for the new name's fingerprint, and the feed's sealed values (name, read id, settings, password hash) are sealed again. Notes are bound to their own names, not the feed's, and are not touched.
* **The license** moves with the feed (`LicenseStore.moveFeed`). If that fails, the feed gets its old name back.
* **Browsers** that unlocked a protected feed unlock it again: the cookie is per name. The plain form clears the old name's cookie.
* **A client package** whose own feed was renamed uses the new name from then on.

This supersedes ADR 0016's "the name stays fixed". Its decision on read ids stands.

### Consequences

* Good, because a feed with the wrong name keeps its notes, read link, license and password under the right one.
* Good, because nothing about former names is kept, and no operator tool is needed to clear such a record.
* Bad, because a script or MCP client that still posts to the old name, unaware of the rename, quietly creates a new feed instead of failing. The settings page, the API description and the docs say so, and a client package follows a rename it made itself.
* Bad, because a freed name can be taken by someone else, who then receives what such a script posts. Choosing a hard-to-guess name and a password for the old one, should it come back, is the owner's.
* Bad, because browsers unlock a renamed protected feed again.
* Bad, because a post under way to the old name while the rename runs can end in a new feed under the old name, as a post during a delete does.
