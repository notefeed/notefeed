---
status: accepted
date: 2026-11-14
decision-makers: Marcel Bruckner
---

# The instance password or accounts, never both

## Context and Problem Statement

Amended by ADR 0062: MCP clients sign in through Better Auth's OAuth server on both kinds of instance, with the account or the instance password.

Amended by ADR 0060: MCP clients on an instance with accounts sign in as the account, through notefeed's own OAuth server until it moves to Better Auth; scripts use account tokens, so a `closed` instance has a way in for both.

An own instance could be locked by an instance password (`NOTEFEED_PASSWORD`, ADR 0001), by sign-in through an identity provider (ADR 0014), or by both. MCP clients authorise through notefeed's OAuth server (ADR 0007), which offered both. Accounts (ADR 0057) add a third way in. Which combinations should an instance allow, and which lock it?

## Considered Options

* Both at once, as with sign-in until now.
* Either the instance password or accounts (chosen).

## Decision Outcome

Chosen: either, because two ways into one instance meant two OAuth flows, two kinds of session and a password that bypasses every account.

* **One setting,** `NOTEFEED_ACCOUNTS`, says who may create accounts:
  * `off` (the default on an own instance)
  * `open` (anyone; notefeed.me)
  * `provider` (only through an identity provider and its allow-list)
  * `closed` (only the operator, over `/api/operator/accounts`)
* **A provider sign-in is an account,** so an identity provider without the setting means `provider`.
* **What locks the instance:** `provider` and `closed` lock it, as sign-in did. `open` leaves it open: feeds work without an account (V12).
* **What refuses to start** (ADR 0055's `PUBLIC_URL` rule extends to every accounts mode):
  * `NOTEFEED_PASSWORD` together with accounts, or with an identity provider
  * `provider` without a provider
  * `off` with a provider
  * `closed` with a provider (its sign-ins would create accounts)
  * accounts without `PUBLIC_URL`
* **MCP OAuth:** a password-locked instance keeps notefeed's own OAuth server. Instances with accounts move to Better Auth's in a later step; until then they keep the provider path of the existing one.

### Consequences

* Good, because each instance has exactly one way in to reason about.
* Bad, because an instance that had a provider and a password for scripts no longer starts. Its scripts need account tokens, which come in a later step, and the upgrading page says so.
* Bad, until that step: a `closed` instance has no way in for scripts or MCP clients, only the web pages.

This amends ADR 0007 and ADR 0014.
