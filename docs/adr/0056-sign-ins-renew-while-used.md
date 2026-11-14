---
status: accepted
date: 2026-11-14
decision-makers: Marcel Bruckner
---

# A sign-in renews while used, is re-checked on every request and lasts 90 days at most

## Context and Problem Statement

A sign-in through an identity provider lasted 7 days from the moment it was made, and use didn't extend it (ADR 0055, and ADR 0014 before it). The fixed end was how taking someone off the allow-list ended their access, so everyone signed in again every week, also in MCP clients. Accounts (the accounts design, phase 2) make sign-in something people keep. How long should a sign-in last, and how does removing someone still take effect?

## Decision Drivers

* No weekly sign-in for someone who uses notefeed every day.
* Taking someone off the allow-list ends their access soon, in the browser and in MCP clients.
* Someone their provider removed, whose address still fits the allow-list (an `@domain` entry), doesn't keep access forever: notefeed never asks the provider again after a sign-in.
* No new setting.

## Considered Options

* Keep the fixed 7 days.
* Renew while used, with no other limit.
* Renew while used, re-check the allow-list on every request, and end every sign-in 90 days after it was made (chosen).

## Decision Outcome

Chosen: renew, re-check, 90 days at most. A session is Better Auth's sliding session: renewed at most once a day while used, ended after 30 days unused. One function (`signedInSession` in `backend/accounts/auth.ts`) reads every session and ends it, deleting it from `accounts.sqlite` and logging the provider and the reason, never who, when:

* the person's provider is no longer configured;
* the allow-list no longer lets in the address and verified flag the provider gave at sign-in; or
* the sign-in is older than 90 days.

Only the proxy renews a session, because only it can hand the renewed cookie to the browser, with the page; every other read (an API request, a server component) leaves the session as it is, so the file and the browser's cookie never disagree about when it ends. An MCP client's refresh token carries the person's id and is re-checked the same way at every refresh, and its chain ends 90 days after the sign-in.

### Consequences

* Good, because a daily user signs in through the provider at most every 90 days, usually one click.
* Good, because a change to the allow-list takes effect at the person's next request, not within 7 days; in an MCP client at its next refresh, within an hour.
* Bad, because someone their provider removed while their address still fits the list keeps access for up to 90 days. The operator takes them off the list, or changes `NOTEFEED_SECRET` to sign everyone out.
* Neutral, because each read of a session costs two small queries on `accounts.sqlite` (the person and their provider), also when the session comes from the 5-minute cookie cache; a page reads it up to three times (the proxy, the page frame, the feed page).
* A sign-in made before this change is renewed at its next use, not ended. An MCP refresh chain from before it has no person's id and ends after its 7 days.
