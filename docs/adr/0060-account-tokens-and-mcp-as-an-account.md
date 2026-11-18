---
status: accepted
date: 2026-11-14
decision-makers: Marcel Bruckner
---

# Account tokens for scripts, and MCP clients that act as an account

## Context and Problem Statement

Accounts (ADR 0057) own feeds (ADR 0059), but only a browser could be signed in as one. A script on an instance that accounts lock had no way in: the instance password is gone with accounts (ADR 0058). An MCP client could sign in only through an identity provider, and on an open instance not at all. How do scripts and MCP clients act as an account? Issue #390.

## Considered Options

* Feed passwords only, one per feed.
* Account tokens for REST and the MCP OAuth server for MCP, each bound to its surface (chosen).
* Better Auth's MCP OAuth server next to notefeed's own.

## Decision Outcome

Chosen: tokens for REST, OAuth for MCP, one server for both kinds of instance.

* **Account tokens** are Better Auth's api-key plugin, in `accounts.sqlite`, hashed.
  * Shape: prefix `nf_`, a name, a scope (`read` or `read+write`) and an end, 90 days by default and at most 365.
  * Made, listed and revoked on the account page, over the API with the page's session (a token makes no tokens), and over MCP.
  * A token acts as its account on every REST operation. A `read` token is refused on any request that writes (`403`, `read_only`).
  * Never accepted on MCP or as a browser's session (conventions: tokens bound to one surface).
* **MCP as an account.** notefeed's OAuth server (ADR 0007) answers wherever the instance is locked or has accounts, also open ones.
  * Its authorize page issues a code for the account signed in on the instance's pages, after **Allow as your account**, from those pages only.
  * The code and both tokens carry the account's id. MCP's tools act as that account: its feeds, claiming, named passwords and tokens.
  * Every refresh checks the account again, as a browser's sign-in is checked (ADR 0056), and the chain ends 90 days after the sign-in.
* **Not Better Auth's MCP server.** It would have been a second OAuth server beside the one the password-locked instance needs: two sets of discovery documents, codes and refresh rules in one codebase. Moving the one server onto Better Auth for every instance is a follow-up.

### Consequences

* Good, because a locked instance with accounts has a way in for scripts and assistants again, and an open one lets them act as an account.
* Good, because a stolen token reaches the REST API only, and a read token can't change anything.
* Bad, because the MCP access token now names the account: it is signed, never stored, and lives an hour.
* Bad, because notefeed keeps OAuth code of its own for now (conventions: Sign-in, Better Auth); the follow-up removes it.

This amends ADR 0007 and ADR 0058.
