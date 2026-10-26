---
status: accepted
date: 2026-10-26
decision-makers: Marcel Bruckner
---

# A license needs no feed password

## Context and Problem Statement

On notefeed.me a license only came with a password: `X-License-Key` counted on the post that creates the feed together with `X-Feed-Password`, and was silently ignored without one (ADR 0029, #193). On an existing feed the key went in through the settings page or `/api/licenses/attach`, which is not part of the public API, the clients or MCP. So a feed created by a script or an assistant could not start licensed, and an agent had to send its user to the settings page to enter the key (#247).

A license is about keeping every note and posting pictures, not about protection: the feed name is the password, and most feeds don't need a second secret.

## Considered Options

* Keep the key tied to the password; document the settings page as the way for open feeds.
* A license on any feed, at creation and later, through every entry point (chosen).

## Decision Outcome

Chosen: a license on any feed.

* **At creation:** `X-License-Key` on the post that creates the feed licenses it, with or without `X-Feed-Password`. The key is checked before anything is stored: a key notefeed doesn't know is `400`, one whose license has lapsed `402`, and nothing is created. A protected feed gets the license as it is created (as before); an open one once its first note made it exist. On a feed that exists a key on a post is still not used, as `X-Read-Id` is not.
* **Later:** `PUT /api/v1/feeds/{feed}/license` `{ "key" }` and `DELETE` in the public API, with the gate of the feed's settings (write access, the post rate limit). The MCP server's `update_feed` takes `license_key` (empty takes it off), and its other fields became optional, so a license is entered without resending the title and description. The clients have `attach_license` / `attachLicense` and `detach_license` / `detachLicense`.
* **Entering a lapsed key is `402` everywhere,** the settings page included, where it used to be put on the feed and give it nothing.
* **A key notefeed doesn't know is a failed attempt,** counted with wrong passwords (`UnknownLicenseKeyError`, `countingKeys`); over the limit no key is looked at. Keys are 128 random bits, so this is defense in depth.

### Consequences

* Good, because a script or an assistant can create a licensed feed in one request, or license an existing one, without the web UI.
* Good, because a license and a password are independent: a license on an open feed can be taken off by anyone who can post to it, as everything else on an open feed can; the key itself stays with its holder, and putting the license back needs it.
* Neutral: ADR 0029's "the post that creates a protected feed carries the key" still holds; it is now one case of the rule.
