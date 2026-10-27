---
status: accepted
date: 2026-10-27
decision-makers: Marcel Bruckner
---

# A feed can be created without a note

## Context and Problem Statement

A feed came into existence only with its first note (ADR 0001, 0008, 0010). To reserve a name, with a password and a license, before anything was ready to post (for example `trilium` for a project's release notes), the only way was to post a placeholder note and delete it again (#295). notefeed is API first: a reservation should be one call from a script or an agent, and one button in the web UI.

## Considered Options

* Keep feeds created by their first note; document the placeholder trick.
* **An explicit create call** (chosen): `POST /api/v1/feeds/{feed}`, MCP `create_feed`, the client packages' `createFeed` / `create_feed`, and *Create feed without a note* in the new feed's card.
* Let `PUT /api/v1/feeds/{feed}` (settings) create a missing feed.

## Decision Outcome

Chosen: an explicit create call. Settings stay "only on an existing feed" (ADR 0010 (i)): a typo in a settings call must not make a feed.

* **What it makes:** an empty feed with its read id, protected from its first moment when a password is given (the same atomic creation as a first post, ADR 0008 (d), 0010 (f)), with the read id asked for (`read_id`, the same rules as `X-Read-Id`). Title and description come after, with `updateFeed`. The read link appears in the feed's JSON once there is a note, as before.
* **Who may, on notefeed.me:** only with a license key, which goes on the new feed (decided by Marcel, 2026-10-27). Free feeds still start with their first note, so empty names are not squatted at no cost. Where no licenses are sold, anyone who may post may create one.
* **Limits:** it counts as a post against the rate limit and against `NOTEFEED_MAX_FEEDS`; a wrong key counts as a failed attempt; reserved and removed names are refused as for a post. A feed that exists, empty or not, is `409 feed_exists`.
* **Web UI:** the button posts `action=create` to `/<feed>/access` with the card's password and key; a protected feed leaves this browser unlocked for it.

### Consequences

* Good, because a name, its password, its license and its read link can be set up before the first post, by a script, an agent or the web UI.
* Supersedes, for this call only, ADR 0010's "a feed is created by its first note"; uploads to an existing empty feed were already allowed (ADR 0011 (c)), so an image can go into a created feed.
* Bad, and accepted: a created feed with no notes counts toward `NOTEFEED_MAX_FEEDS` until deleted.
