---
status: accepted
date: 2026-10-26
decision-makers: Marcel Bruckner
---

# A note's id is opaque, its date is its own

## Context and Problem Statement

A note's time was part of its id (`<stamp>-<uuid v7>`, the stamp to the second). Feed order, the `before` cursor and RSS read the time from there (ADR 0018). That made backdating possible (`X-Note-Created`), but every later change of a note's time would have been a change of its identity. Two things were wanted: a note dated in the future that readers see only from then on (a scheduled note), and a date that can be changed at any time, published or not.

## Decision Drivers

* A note's links, RSS `guid` and references from its text must not change when its date does (ADR 0009).
* A scheduled note must be unreachable for readers by every route before its date: a guessed id gives the same answer as a missing one.
* One storage interface over the file system, SQLite and PostgreSQL (ADR 0023); metadata is sealed at rest (ADR 0033), so the date must be readable without opening it.
* No listing that opens every note's metadata to sort a feed.

## Considered Options

* A. Keep the time in the id; a date change renames the note.
* B. An opaque random id and the date as a field of its own (chosen).
* Content hashes as ids.

A keeps order, paging and RSS as they are, and a poller for "after the last id" would see a scheduled note when it goes live. But every date change breaks the note's links, changes its RSS guid and needs the text's references rewritten. Content hashes (to share notes between feeds) change when a note's content is replaced with `PUT`, collide for equal content in two notes, and let anyone test whether a feed holds a known image.

## Decision Outcome

Chosen: B. A note's identity does not depend on its date. Performance did not decide: a large instance runs on a database, where ordering by a date column is one index, and the file system serves small feeds.

* **Ids.** 22 characters of base64url from 16 random bytes, like read ids. Nothing parses an id any more (`stampOf` is gone); a file placed by hand is still a note, dated by its metadata, else its modification time.
* **The date.** Stored with the note and readable without decrypting it, in ms since the epoch. SQL: a `date` column with an index `(feed, date, id)`; `created_at` stays what it was, when the row was written. File system: a plaintext field outside the sealed part of the sidecar. Order is the date, newest first, ties by id; the `before` cursor is still a note id. Storage lists, counts and pages in this order, optionally only up to a time (`visibleAt`).
* **Posting and changing.** `X-Note-Date` (formerly `X-Note-Created`, no alias) takes 1970 to 9999, also the future. `PATCH` takes `date` beside `title` and `alt`; the clients, the CLIs, MCP and the UI have it. An attachment records its text note (`of`) and gets the text's date minus 1 ms, also when the text's date changes.
* **Scheduled notes.** A note with a date after now is hidden from readers everywhere (read page, RSS, read API, file and single-note routes, counts) and answers `404` like a missing one. The owner sees it, marked (`scheduled`). Nothing runs at its time; visibility is decided when a request is answered.
* **Migration.** At start, every note with an old stamped id gets a new id and its date from the stamp. The new id is an HMAC of feed and old id under the instance secret, so a run cut short repeats to the same result. Sealed content and metadata are bound to the note's name, so a renamed note is opened under the old name and sealed under the new one; the text's references to its files are rewritten.

### Consequences

* Good, because a date can move freely without a broken link or a new RSS item.
* Good, because a scheduled note cannot leak by guessing: the id gives no time and no order.
* Bad, because old links to notes and files break. Links from one feed to another are absolute URLs in text and are not rewritten (on notefeed.me the blog posts linking to `releases` are fixed by hand). RSS guids change once; there were no subscribers worth the care.
* Bad, because pollers that ask for the notes after the last id no longer work: ids carry no order. They fetch the newest page and look for ids they have not seen; the docs say so.
* Bad, because listing costs more on the file system: it reads every sidecar's plaintext date and sorts in memory. SQL does it in the index. A date on every row and a migration of every note are the price.
* Bad, because the API changes without an alias: `createdAt`, `created_at` and `X-Note-Created` are now `date` and `X-Note-Date`; the release notes say so.
* Amends ADR 0009 and ADR 0018 where they say a note's id carries its time.
