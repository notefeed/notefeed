---
status: accepted
date: 2026-11-16
decision-makers: Marcel Bruckner
---

# MCP sign-in on Better Auth where there are accounts

## Context and Problem Statement

An MCP client signed in as an account through notefeed's own OAuth server (ADR 0007), extended to accounts in ADR 0060 to keep one server for every instance. The conventions rule out OAuth code of our own next to Better Auth: an app with Better Auth signs MCP clients in with `@better-auth/mcp` and `@better-auth/cimd`, tokens bound to the MCP resource, dynamic registration where a client needs it (conventions: Sign-in, Better Auth). Which server should an instance with accounts use, and what of the one the instance password needs? Issue #401.

## Considered Options

* Keep notefeed's server for every instance (ADR 0060).
* Better Auth's server where there are accounts; notefeed's own only where the instance password locks (chosen).
* Better Auth's server for every instance, the password one included.

## Decision Outcome

Chosen: Better Auth's where there are accounts, because that is where Better Auth already runs and a person signs in. An instance has accounts or the instance password, never both (ADR 0058), so each instance still answers with one server.

* **Better Auth's `mcp` plugin** issues the tokens, with `cimd` for clients that bring a metadata document and dynamic registration without a session (claude.ai needs it; it counts toward the posts limit). A client registering loopback redirects without saying it is native (Cursor, older Claude Code) is taken as native.
* **The authorize page** is Better Auth's login and consent page: signed out, it sends you to the login page (number and key, a passkey or a provider) and back; signed in, **Allow as your account** or **Deny**, answered on the server with the signed request. A client allowed once is not asked again.
* **Discovery:** the issuer is `<PUBLIC_URL>/api/auth`; its metadata is at `/.well-known/oauth-authorization-server` and below it at the issuer's path, and `/.well-known/oauth-protected-resource/mcp` names it. Of Better Auth's routes only authorize, token, register, revoke and the keys are served; the rest stay 404.
* **`/mcp`** checks the token with `requireMcpAuth` (signature, issuer, audience `/mcp`, expiry), then that its account may still be signed in, on every request. An open instance still lets a client without a token in, as no one.
* **The sender** of a client's notes is its account's, from the identity provider.
* **The MCP sign-in through a provider** (`/api/oidc/start` with the authorize fields) goes: a provider signs a person in like any sign-in, and the login page brings them back to the authorize page.
* **notefeed's own server** stays for instances the instance password locks, and loses everything about accounts and senders. Moving it too is #401.

### Consequences

* Good, because sign-in code of notefeed's own is gone wherever there are accounts, and clients get standard discovery, registration and refresh.
* Good, because a removed account or a person taken off the allow-list loses MCP at the next call, not at the next refresh.
* Bad, because the server keeps state: clients, consents and refresh tokens in `accounts.sqlite` (and the JWT signing keys), where notefeed's own kept none.
* Bad, because an MCP client's access no longer ends 90 days after the sign-in (ADR 0056): a refresh token lasts 30 days from its last use, so a client in use keeps working until the account is deleted or its person leaves the allow-list.
* Bad, because two OAuth servers stay in the code until #401 moves the password one.

This supersedes ADR 0060's choice of notefeed's server for accounts and amends ADR 0007 and 0058.
