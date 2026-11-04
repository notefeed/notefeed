---
status: accepted
date: 2026-10-27
decision-makers: Marcel Bruckner
---

# Licensed feeds skip the post rate limit

## Context and Problem Statement

`NOTEFEED_RATE_LIMIT` is one per-client budget for every post, edit and delete, a fixed one-minute window in memory (`backend/limits.ts`). It is not tied to a feed. A paying feed posted to by a release workflow or a monitoring script can hit it in a burst and get `429`, although the feed is what was paid for (#123). What should a license give?

## Considered Options

* **Exempt:** writes to a feed with an active license don't count against the post budget (chosen).
* A multiplier: a licensed feed gets N times the limit (a new setting).
* Leave the limit as it is.

## Decision Outcome

Chosen: exempt, decided by Marcel on 2026-10-27. It is the simplest rule to explain ("a licensed feed is not rate limited") and needs no new setting.

* **Where:** the gate every write passes (`admit` in `backend/posting.ts`), after the feed's access is checked: on an instance that sells licenses, a feed with an active license skips the post counter. Reserved feeds and instances without licensing are unchanged.
* **What still counts:** wrong passwords and wrong license keys, in their own bucket, checked before; requests to feeds without a license; the license endpoints' own limits.
* **Lapsed:** a lapsed license counts again, like a free feed.

### Consequences

* Good, because CI and scripts posting to a paid feed never see `429` from it.
* Bad, and accepted: whoever has access to a licensed open feed (its name) can write to it without a limit. They could already post, edit and delete everything in it; a licensed feed can have a password, which is the protection against that.
* The counter stays per process (#129); with several instances that matters only for unlicensed feeds now.
