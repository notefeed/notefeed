---
status: accepted
date: 2026-11-18
decision-makers: Marcel Bruckner
---

# A note's language is a field, not a tag convention

## Context and Problem Statement

Notes posted for a website built from a feed (a blog post on the `3dbruckner` feed) carried their language and URL as tags, `lang:de` and `slug:kamera-am-drucker`. Readers saw them as tag chips under the note and in the feed's tag filter, next to real topics. They counted against the ten tags, and nothing checked them: `lang:deutsch` or two `lang:` tags were taken. How should a note carry its language, and its path? Issue #409.

## Considered Options

* Keep the tag convention, and hide `lang:` and `slug:` tags from readers.
* Two fields, `language` and `path`, with the old tags moved into them on write.
* A `language` field only; `slug:` stays an ordinary tag (chosen).

## Decision Outcome

Chosen: a `language` field only. A tag that the UI has to hide is no longer a tag. And notefeed itself uses the language: it marks the note's text for screen readers and feed readers.

A path field was built and then dropped. Nothing reads it: no site builds its URLs from a feed today. A site that wants a stable link already has the note's id and its `name` (`/r/{readId}/{name}`). A field that only an imagined reader would use is a field to maintain for nothing. If such a site appears, a path can come back as its own change. Until then a `slug:` tag is a tag like any other.

* **`language`** (`X-Note-Language`): a BCP 47 language tag. It is a language of 2 or 3 letters, then subtags of 1 to 8 letters or digits, each after a single hyphen, at most 35 characters. It is stored with the language lower-case, a script title-case and a region upper-case (`pt-BR`, `zh-Hant-TW`).
* **The rule lives once.** The field is listed in `backend/notefields.ts`, so the REST headers, the `PATCH` JSON and the MCP tools take it. Its check is in `backend/language.ts` and its pattern in `shared/language.ts`, which the compose box uses too. It is kept in the note's metadata like the title, so no backend needs a migration.
* **Where it goes.** On a post with pictures it goes on the text note; with no text, on each picture, like the title. An empty value on an edit removes it.
* **The old tags.** A post or an edit whose tags hold exactly one valid `lang:` tag, and that does not set the language itself, moves the tag into the field and does not store it as a tag. Two of them, or a value the field refuses, stay tags, so nothing a poster sends is lost. Scripts and agents that still send the tag keep working. Notes stored before this keep their tags until they are edited; `scripts/move-lang-tags.mts` sends a feed's affected notes their own tags again through the API, which moves them.
* **What readers see.** The note's text is marked with its language (`lang` on the page and card, `<dc:language>` in RSS, `xml:lang` in Atom). The foot shows the language quietly, as its tag in capitals.

### Consequences

* Good, because `lang:` tags no longer crowd the tag filter.
* Good, because screen readers and feed readers know a note's language (WCAG 3.1.2).
* Good, because every surface gets the field from one list (V11).
* Bad, because a feed with old `lang:` tags shows them until its notes are edited or the script has run.

## More Information

Values: V11 (all surfaces at once, MCP first); V3 (publishing metadata, no interaction); V1 and V2 (no personal data).
