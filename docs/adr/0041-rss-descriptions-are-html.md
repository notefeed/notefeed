---
status: accepted
date: 2026-10-25
decision-makers: Marcel Bruckner
---

# An RSS item's description is the note's text as HTML

## Context and Problem Statement

The RSS feed carried a markdown note's raw markdown as its description. Readers show a description as HTML, so a reader (dynacat) showed the literal `![](…)` of a picture, no picture as the item's image, and a picture note without a title under its id (`20261024T150053Z-01a16e6d-…`).

## Considered Options

* Keep the raw markdown; readers that understand markdown are few.
* Render the markdown to HTML on the server, with the page's parser (chosen).

## Decision Outcome

Chosen: HTML, so a reader shows what the page shows.

* **`backend/rsshtml.ts`**: remark with GFM, the parser react-markdown uses for the page, then HTML. Raw HTML in a note becomes text, as on the page: a reader never runs it. Pictures of the feed (relative links) become absolute.
* **The first picture of the text** is the item's `<media:content>` and `<media:thumbnail>` (Media RSS), declared only when an item has one. Not an `<enclosure>`: that needs the file's length, and a picture note already has its own.
* **An item's title** is the note's; for a picture note without one, its alternative text, else the name it was posted with, else "Picture" and its time; never its id.

### Consequences

* Good, because readers show notes as the page does, pictures included.
* Bad, because a reader that wanted the markdown gets HTML; the API's `markdown` field and the files keep it.
