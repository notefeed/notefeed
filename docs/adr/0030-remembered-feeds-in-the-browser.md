---
status: accepted
date: 2026-10-14
decision-makers: Marcel Bruckner
---

# The feeds a person uses are remembered in their browser, not on the server

## Context and Problem Statement

The redesign (issue #185) gives notefeed the structure of a social app: a feed switcher on the phone, the feeds in a left column on a wide screen, and a share target that asks which feed a shared text goes to. All of these need a list of "your feeds". notefeed has no accounts and stores nothing about anyone (ADR 0014): a feed is reached by knowing its name. Where does the list come from?

## Considered Options

* **The browser's localStorage:** each writable feed page puts its feed first in a list (name, title, title image URL); the list is read on the client. Chosen.
* **A cookie** with the names, so the server could render the list.
* **Accounts**, or a server-side list keyed by a device token.

## Decision Outcome

Chosen option: localStorage, because it keeps the server as it is (no accounts, no list of who uses which feed) and needs nothing from the person.

* **What is stored:** the feed's name, title and title image URL, newest first, at most 50, under `notefeed:feeds` (`components/RememberedFeeds.tsx`). Only the writable pages add to it; the read-only pages never do, since they must not know the name (ADR 0001).
* **Never sent anywhere.** A cookie would send every feed name with every request, to every feed's page; the names are the feeds' secrets.
* **Forgetting** is per entry ("Forget on this device") or by clearing the site's data.
* **Without storage** (a private window, blocked site data) the list is empty and everything else works; without JavaScript there is no list, and the feed name field on the start page and in the switcher still opens any feed.

### Consequences

* Good: no new data on the server, no consent question for the operator: the list is a function the person uses on their own device.
* Bad: the list does not follow a person to another browser or device; the native apps (#149) will keep their own.
* The operator's privacy page may mention that the browser keeps the names of the feeds opened in it.
