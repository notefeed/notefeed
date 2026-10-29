---
status: accepted
date: 2026-10-29
decision-makers: Marcel Bruckner
---

# The operator takes down one post, and leaves a mark in its place

## Context and Problem Statement

The operator's takedown (ADR 0027) removes a whole feed for good, its name and read id included, because the feed was the unit a report could name without the feed's name. A report now carries the note id as well (ADR 0026), and an image is a note of its own (ADR 0018), so one note can be named. For a feed that is otherwise fine, removing all of it punishes an owner who may have done nothing wrong, and it cannot be undone. Issue #159 asks for the smaller measure. What goes, what is left behind, and who can remove what is left (V9)?

## Considered Options

For what is left behind:

* **A mark that is a note of its own type** (chosen): the takedown deletes the post and writes, in the text note's place, a note of the type `removed` with that note's id and date and no content; the removed ids are recorded as tombstones of the feed.
* **No stored mark; the lists merge tombstone records in:** one record would serve both the mark and the `410`, but every list path (paging, tag filters, counts, RSS, the free plan's cap) would merge a second source, and deleting the mark would be a second delete path.
* **No mark at all,** only a `410` for the removed ids: readers and the owner would not see that the operator removed something.

For what goes:

* **The post** (chosen): the note named, the text note it was posted with if it is an attachment, and every attachment of that text. Content that is reported for being illegal rarely comes alone; the attachments of a text were posted with it.
* Only the note named: an attachment would stay inside a removed text's place, or a text would stay around a removed picture.

## Decision Outcome

Chosen: the post goes, and a mark of its own type takes its place.

* **Named by what a report carries,** in the same operator endpoint: `POST /api/operator/takedown` with `"scope": "note"` and a note's read URL, an image URL (by id or by the name it was posted with) or `<read id>/<note id>`. Without `scope` the target means the whole feed, as before. The answer lists the removed note ids, the number of hashes blocklisted and the image store keys; it never names the feed, nor does the log (ADR 0015).
* **The tombstones first:** the removed ids are recorded in the feed (`note_tombstones`, migration `008_note_tombstones`, keyed like the notes so the keyring's sealing moves them with them; `.removed-notes` in the feed's folder on the file system), then the notes and their objects go, then the mark is written. From the tombstone on, every read of one of the ids, the note's page, its file, the owner's and the reader's API and MCP's `get_note`, answers *removed by the operator* (`410`, `removed`), for good, also after the mark is deleted. Editing the mark is refused the same way. A crash in between leaves notes nobody is served; the next takedown of the same post removes them.
* **The images' hashes** go on the instance's blocklist before the bytes go, as with a feed.
* **The mark** (`backend/note/removed.ts`) has the text note's id, date and draft state, so readers learn nothing they could not see before. It says *Removed by the operator: this broke the content rules of this instance.*, links to the instance's terms page when there is one, has no Report link, and is an RSS item without an enclosure. In the APIs it is a note with `removed: true` and the type `application/x-notefeed-removed`, which no post can declare. It counts as a note for the caps.
* **Whoever can post to the feed can delete the mark** (V9): with the ordinary delete, in the web UI, the API, MCP and both clients. The post does not come back.
* **Only the stored link counts as connected:** a note that shows one of the removed images in its markdown stays, and the image answers `410` inside it. When more of the feed looks connected than one post, the operator removes the feed.
* **The tombstones go with the feed:** deleting the feed, by its owner or by a feed takedown, removes them.

### Consequences

* Good, because a report about one post in a feed that is fine no longer costs the feed, its name and its read id.
* Good, because readers and the owner see that the operator removed something, and the owner keeps the last word on what the feed shows (V9).
* Good, because the mark is a note, so every list, RSS, the APIs and MCP show it without a second way of listing.
* Bad, because readers see the mark until the owner deletes it, which on a feed nobody looks after is for good.
* Bad, because a removed image asked for by the name it was posted with answers `404`, not `410`: the name names no note once the note is gone.
* Bad, because the note tombstones never shrink while the feed lives; a line or a row per removed note, so it does not matter in practice.
