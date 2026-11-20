---
status: accepted
date: 2026-11-20
decision-makers: Marcel Bruckner
---

# An image enlarges where it shows

## Context and Problem Statement

An image posted with a note is a note of its own (ADR 0019, 0021), with its own page. Clicking an image in the feed opened the note, as any click on a card does (ADR 0040). On the note's page, the click opened the image's own page. Someone reading a post who clicks an image wants to see it larger, not to leave the post, and a note with several images gave no way to look through them. Issue #418.

## Considered Options

* A dialog over the page that shows the image enlarged, in the feed and on the note's page, with arrows through the note's images.
* Keep the links to the image's page, and make that page show the image larger.

## Decision Outcome

Chosen option: the dialog, because it keeps the reader where they were. An image in a note's text (unless the text put it in a link) and an image note's image open in a dialog, as large as the screen allows. Arrows, the arrow keys and a one-finger swipe (which slides them) step through the images of the same note; two fingers pinch-zoom as anywhere else. Esc, the close button or a click beside the image closes it. An image with a page of its own shows a link to that page in the dialog, so its address can still be shared.

This changes one rule of ADR 0040: an image in a card is now something to click that does not open the note. Every other click on the card still opens the note. Underneath, each image is a link to its page (else to the file), so without JavaScript or with a modifier key the click goes there.

### Consequences

* Good, because a post can be read and its images looked at without leaving the page.
* Bad, because a reader who wants the image's own page needs one more click.
