---
status: accepted
date: 2026-11-16
decision-makers: Marcel Bruckner
---

# MCP sign-in through Better Auth only; no OAuth without accounts

## Context and Problem Statement

An MCP client signed in as an account through notefeed's own OAuth server (ADR 0007), extended to accounts in ADR 0060 to keep one server for every instance. The conventions rule out OAuth code of our own next to Better Auth: an app with Better Auth signs MCP clients in with `@better-auth/mcp` and `@better-auth/cimd`, tokens bound to the MCP resource, dynamic registration where a client needs it (conventions: Sign-in, Better Auth). Which server should an instance with accounts use, and does an instance the password locks need one at all? Issue #401.

That server existed for clients that couldn't send a header, above all the Claude.ai and Claude Desktop connectors. Claude.ai's connectors now take request headers (in beta), so they can send the instance password as a Bearer token, as Claude Code always could.

## Considered Options

* Keep notefeed's server for every instance (ADR 0060).
* Better Auth's server where there are accounts; notefeed's own where the instance password locks.
* Better Auth's server for every instance, standing in for "the instance" behind the password.
* Better Auth's server where there are accounts; no OAuth without them (chosen).

## Decision Outcome

Chosen: Better Auth's where there are accounts, because that is where Better Auth already runs and a person signs in; none without, because the instance password is a header any client can now send, and keeping OAuth code of our own for it is what the conventions rule out. A client that can't send headers yet has accounts (`NOTEFEED_ACCOUNTS=closed`).

* **Better Auth's `mcp` plugin** issues the tokens, with `cimd` for clients that bring a metadata document and dynamic registration without a session (claude.ai needs it; it counts toward the posts limit). A client registering loopback redirects without saying it is native (Cursor, older Claude Code) is taken as native.
* **The authorize page** is Better Auth's login and consent page: signed out, it sends you to the login page (number and key, a passkey or a provider) and back; signed in, **Allow as your account** or **Deny**, answered on the server with the signed request. A client allowed once is not asked again.
* **Discovery:** the issuer is `<PUBLIC_URL>/api/auth`; its metadata is at `/.well-known/oauth-authorization-server` and below it at the issuer's path, and `/.well-known/oauth-protected-resource/mcp` names it. Of Better Auth's routes only authorize, token, register, revoke and the keys are served; the rest stay 404.
* **`/mcp`** checks the token with `requireMcpAuth` (signature, issuer, audience `/mcp`, expiry), then that its account may still be signed in, on every request. An open instance still lets a client without a token in, as no one.
* **The sender** of a client's notes is its account's, from the identity provider.
* **The MCP sign-in through a provider** (`/api/oidc/start` with the authorize fields) goes: a provider signs a person in like any sign-in, and the login page brings them back to the authorize page.
* **notefeed's own server goes** (`backend/oauth`, `/oauth/register`, `/oauth/token`, the password form). An instance the password locks takes `Authorization: Bearer <password>` on `/mcp` and answers 401 with a plain `Bearer` challenge; its discovery routes are 404, like an open instance's.

### Consequences

* Good, because notefeed has no OAuth code of its own any more, and clients get standard discovery, registration and refresh.
* Good, because a removed account or a person taken off the allow-list loses MCP at the next call, not at the next refresh.
* Bad, because the server keeps state: clients, consents and refresh tokens in `accounts.sqlite` (and the JWT signing keys), where notefeed's own kept none.
* Bad, because an MCP client's access no longer ends 90 days after the sign-in (ADR 0056): a refresh token lasts 30 days from its last use, so a client in use keeps working until the account is deleted or its person leaves the allow-list.
* Bad, because a connector that logged in with the password on its OAuth page stops working on upgrade: it needs the password as a request header (where its organization has them) or the instance needs accounts.

This supersedes ADR 0060's choice of notefeed's server for accounts and the OAuth server of ADR 0007, and amends ADR 0058.
