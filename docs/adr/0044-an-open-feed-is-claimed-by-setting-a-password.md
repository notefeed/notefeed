---
status: accepted
date: 2026-10-27
decision-makers: Marcel Bruckner
---

# An open feed is claimed by setting a password

## Context and Problem Statement

A feed could only get a password on the post that creates it (ADR 0008, *Claiming*), and on notefeed.me that post also needs a license key (ADR 0029, #193). A feed that started open, because a password wasn't needed then, could never be protected: the way out was a new feed under a new name, which breaks every script and read link (#248).

ADR 0008 rejected *first to set wins* so that nobody who merely knows a feed's name could lock its owner out. But on an open feed, knowing the name already is full access: whoever has it can post, edit and delete every note, change the read link and delete the feed. A password set by such a stranger adds nothing they could not already do.

## Considered Options

* Keep passwords create-only.
* **First to set wins:** whoever has access to the open feed, which is whoever knows its name, may set one (chosen).
* **A proof beyond the name:** the feed's license key where licenses are sold, and the operator elsewhere.

## Decision Outcome

Chosen: first to set wins. The feed's name is an open feed's first and only protection; once it is shared, everyone it was shared with may claim the feed by setting a password.

* `PUT /api/v1/feeds/{feed}/password` on an open feed sets one without a current password; on a protected feed it changes the password with the current one, as before. A feed that does not exist is `404`. The same is the settings page's **Feed password** row on an open feed, `update_feed`'s `new_password` in the MCP server, and `set_feed_password` / `setFeedPassword` in the client packages.
* Where licenses are sold, a password still needs a licensed feed (ADR 0029): an unlicensed open feed answers `402`, and a license goes on it with its key first (ADR 0043).
* The read link and RSS stay open, as for every protected feed; posting, the feed's page by name and its API need the password from then on.

### Consequences

* Good, because a feed that started open can be protected without a new name, on every instance, with no operator step.
* Bad, and accepted: someone who learns an open feed's name can lock its owner out. They could already delete the feed with everything in it; an owner who cares sets the password first. On notefeed.me a locked-out owner who holds the feed's license key gets back in with *Forgot the password?* (ADR 0037).
* A post that sends a password to an existing open feed is still `409 feed_exists`: claiming is the password route's job, not a side effect of posting.
* This supersedes ADR 0008's *Claiming* decision (only when the feed is created).
