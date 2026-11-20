---
status: accepted
date: 2026-11-20
decision-makers: Marcel Bruckner
---

# A picture enlarges where it shows

## Context and Problem Statement

A picture posted with a note is a note of its own (ADR 0019, 0021), with its own page. Clicking a picture in the feed opened the note, as any click on a card does (ADR 0040). On the note's page, the click opened the picture's own page. Someone reading a post who clicks a picture wants to see it larger, not to leave the post, and a note with several pictures gave no way to look through them. Issue #418.

## Considered Options

* A dialog over the page that shows the picture enlarged, in the feed and on the note's page, with arrows through the note's pictures.
* Keep the links to the picture's page, and make that page show the picture larger.

## Decision Outcome

Chosen option: the dialog, because it keeps the reader where they were. A picture in a note's text (unless the text put it in a link) and an image note's picture open in a dialog, as large as the screen allows. Arrows and the arrow keys step through the pictures of the same note. Esc, the close button or a click beside the picture closes it. A picture with a page of its own shows a link to that page in the dialog, so its address can still be shared.

This changes one rule of ADR 0040: a picture in a card is now something to click that does not open the note. Every other click on the card still opens the note. Underneath, each picture is a link to its page (else to the file), so without JavaScript or with a modifier key the click goes there.

### Consequences

* Good, because a post can be read and its pictures looked at without leaving the page.
* Bad, because a reader who wants the picture's own page needs one more click.
