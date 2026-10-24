---
status: accepted
date: 2026-10-24
decision-makers: Marcel Bruckner
---

# The UI tells note types apart through one registry of kinds

## Context and Problem Statement

ADR 0019 made a new type of note one `Note` subclass and one entry in the backend's registry (`backend/note/types.ts`), "and every endpoint, client and the UI follow". The UI did not: the list card, the note's page, both note page routes and the edit form each tested `type.startsWith("image/")` by hand, and which note a click on a picture opened was three special cases in three files. Attachments (`shared/pictures.ts`) knew only pictures. A third type would have meant touching all of them again.

## Considered Options

* Keep the tests of the media type where they are.
* A registry of kinds for the UI, keyed by the backend's type names, with the links decided by the card and the page, not by the kinds (chosen).
* Move rendering into the backend's `NoteType`.

## Decision Outcome

Chosen: a registry of kinds. The backend stays free of React (ADR 0003), and the UI follows the backend's types by name.

* **`shared/notekinds.ts`**: `kindOf(mediaType)` is the one place that tells kinds apart by media type. A kind says which files its text refers to as attachments, whether it can be an attachment, and whether it has text and an alternative text to edit. Lists, RSS included, leave out attachments shown by another listed note (`withoutAttachments`), and `attachmentLinks` gives an attachment's page.
* **`components/NoteBody.tsx`**: one body per kind, a heading and the content, for a card or a page. A body draws content only.
* **One click rule, in `CardContent` and `PageContent` (`components/NoteBody.tsx`)**: in a list, everything on a note's card opens that note, its attachments too; on a note's own page, an attachment opens the attachment's own page.
* **Kept in step by a test**: `backend/note/types.test.ts` checks that every backend type has the kind of the same name for each of its media types, with the same alternative text rule.

### Consequences

* Good, because a new type is a backend entry, a kind and a body; the list, the pages, the click rule and the edit form follow.
* Good, because the behaviour did not change: the existing unit and e2e tests pass unchanged.
* Bad, because the kinds repeat a little of the backend's registry (the names, the alternative text rule); the test catches a drift.
* Neutral: the backend still lists only image notes as possible attachments (`getFeedPictures`), and the compose box accepts only images; a type that can be an attachment widens both.
