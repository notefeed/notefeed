---
status: accepted
date: 2026-10-25
decision-makers: Marcel Bruckner
---

# A markdown note shows its text as written; only its own title is a heading

## Context and Problem Statement

A markdown note's title is the title set when it was posted or edited, else one taken from its text (`extractTitle`: the first `# ` heading, else the first line). The list card showed that title as a bold link and then the text without the line the title came from (`bodyAfterTitle`); the note's page showed the text as written. Two bugs followed from guessing which line was the title: a note posted with a title of its own lost its first line on the card (the release notes on notefeed.me/r/releases), and on the page a title from a plain first line looked like any other line. A note with no title at all showed its id as the heading.

## Considered Options

* Split title and text on the page as on the card, with exceptions for a picture or a heading further down.
* Show the text as written on card and page; a heading above it only for a title of the note's own (chosen).

## Decision Outcome

Chosen: the text as written. What was written is what is shown, and nothing has to guess which line is the title.

* **`components/NoteBody.tsx`**: a markdown note's heading is its own title (`meta.title`), unless that is the text's first line, which already shows. The content is the whole text, on the card and on the page.
* **The derived title stays** wherever something needs a name: RSS item titles, the API's `title`, a picture's alternative text when it has none, the browser's title, and the name of the note's link.
* **A click anywhere on a card opens the note** (`components/NoteCard.tsx`), which was ADR 0038's rule for a card's content and now holds without a title link. The note's time in the card's foot is the link itself, named by its title ("Hello, 11:19"), for keyboards, screen readers and opening in a new tab; a click on a link or control inside the card, with a modifier key, or one that ends a text selection is left alone. Nothing else in the card's content links but what the note's text links to, so a later collapsed card can open the same way. An overlay link over the whole card was not chosen: it would stop text from being selected.
* **In a card, a `# ` or `## ` heading of the text is no bigger than a title** (`.note-card` in `app/globals.css`), so a feed of notes that start with `# ` looks as before.
* `bodyAfterTitle` is gone.

### Consequences

* Good, because a note looks the same in the list and on its page, and a line is never dropped.
* Good, because notes without a title, as scripts and chats post them, read like messages rather than as articles with a guessed headline.
* Bad, because a note whose first line was meant as a title but is not a `# ` heading now shows it as a plain line; giving it a title of its own or a `# ` makes it one.
