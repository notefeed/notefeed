---
status: accepted
date: 2026-10-28
decision-makers: Marcel Bruckner
---

# A draft is a state of its own

## Context and Problem Statement

Whoever posts to a feed wants to keep a note there before it is meant for readers, and publish it later without a new id (#265). The `post-to-notefeed` skill kept drafts in a separate drafts feed, which loses the id, links and references when the note moves. A scheduled note (ADR 0042) is already hidden from readers until its date. Is a draft a note with no date yet, a flag beside the date, or a note kept somewhere else?

## Decision Drivers

* A draft must never reach a reader, by any route (V3): read page, RSS, read API, the single-note and file routes on the read link, files by name (ADR 0045), counts, the feed's title image.
* Its pictures (ADR 0042: an attachment records its text with `of`) must stay hidden with it.
* A note may be written for any date, past or future; publishing must not move it.
* Listing and counting must not open (decrypt) every note (ADR 0042, ADR 0033).
* Everything in the REST API, both clients, MCP and the UI (V11).

## Considered Options

* A. A plain `draft` flag beside the date, which storage leaves out of every listing unless asked for (chosen).
* B. The flag inside the sealed metadata, filtered after opening each note.
* C. Drafts kept in a table or folder of their own, moved on publishing.
* A draft as a note without a date (or with a sentinel one), reusing the filter of scheduled notes.

## Decision Outcome

Chosen: A. The flag is stored in plaintext beside the date: a `draft` column on SQLite and PostgreSQL (`007_note_draft`, index `(feed, draft, date, id)`), `draft: true` in the file system sidecar. `listNoteRefs` leaves drafts out unless the caller passes `drafts: true`, so a listing that does not ask never has one. `notes.ts` asks only on the owner's paths, those without `asOf`; every reader's lookup by id or file refuses a draft as a missing note (`404`).

B would decrypt every note to list a feed. C makes publishing a move on three backends, pictures included, while sealed content is bound to a note's name. A dateless draft cannot also carry the date it is written for, and the owner decided against reusing the date.

* **Publishing changes only the state.** The note keeps its date: a past one places it there, a future one makes it a scheduled note. Making a published note a draft again hides it from readers again.
* **Pictures follow their text**, on posting, on publishing and unpublishing, and when an edit adds pictures to a draft. A picture posted with a note can't change its state on its own (`400`): published alone, it would show part of a draft.
* **The title image.** A draft picture cannot be set as the feed's title image (`400`), and a note whose picture is the title image cannot become a draft (`409`, `title_image`).
* **Limits.** A draft counts toward a feed's free-tier limits like any note: it is stored.
* **Setting it.** `X-Note-Draft: true` on a post (raw or multipart), `draft` in the `PATCH` body, `draft: true` on an owner's note and on a post's answer; MCP `post_note`, `post_file` and `edit_note` take `draft`; the clients take `draft`, their CLIs `post --draft` and `update --draft` / `--publish`; the compose box and the edit form have a checkbox, and the note's card says **Draft**.

### Consequences

* Good, because a draft keeps its id, links and references when it goes live.
* Good, because hiding is the storage default: a reader's route has to do nothing to leave drafts out.
* Good, because the date stays the author's: a draft written for March is a March note when published.
* Bad, because a draft published with a past date appears in RSS at that date, below newer items; a feed reader that only looks at the top may never show it.
* Bad, because a SQL migration rebuilds the notes index.
* Amends ADR 0042's list of what readers do not see.
