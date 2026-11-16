---
status: accepted
date: 2026-11-16
decision-makers: Marcel Bruckner
---

# MCP sign-in through Better Auth only, with accounts or the instance password

## Context and Problem Statement

An MCP client signed in as an account through notefeed's own OAuth server (ADR 0007), extended to accounts in ADR 0060 to keep one server for every instance. The conventions rule out OAuth code of our own next to Better Auth: an app with Better Auth signs MCP clients in with `@better-auth/mcp` and `@better-auth/cimd`, tokens bound to the MCP resource, dynamic registration where a client needs it (conventions: Sign-in, Better Auth). Which server should an instance with accounts use, and what of the one the instance password needs? Issue #401.

The password's server exists for clients that can't send a header, above all the Claude.ai and Claude Desktop connectors. Their request headers are in beta and not open to every organization, so an OAuth login with the password is still needed.

## Considered Options

* Keep notefeed's server for every instance (ADR 0060).
* Better Auth's server where there are accounts; notefeed's own where the instance password locks.
* Better Auth's server where there are accounts; no OAuth without them (the password only as a header).
* Better Auth's server for every instance that is locked or has accounts; behind the password, one Better Auth user stands for the instance (chosen).

## Decision Outcome

Chosen: Better Auth's server wherever OAuth is needed, because it removes OAuth code of our own (what the conventions rule out) without taking the connector login from password-locked instances. An instance has accounts or the instance password, never both (ADR 0058), so the server always has one way to say who the client acts as.

* **Better Auth's `mcp` plugin** issues the tokens, with `cimd` for clients that bring a metadata document and dynamic registration without a session (claude.ai needs it; it counts toward the posts limit). A client registering loopback redirects without saying it is native (Cursor, older Claude Code) is taken as native.
* **The authorize page** is Better Auth's login and consent page. With accounts: signed out, it sends you to the login page (number and key, a passkey or a provider) and back; signed in, **Allow as your account** or **Deny**, answered on the server with the signed request. A client allowed once is not asked again.
* **Discovery:** the issuer is `<PUBLIC_URL>/api/auth`; its metadata is at `/.well-known/oauth-authorization-server` and below it at the issuer's path, and `/.well-known/oauth-protected-resource/mcp` names it. Of Better Auth's routes only authorize, token, register, revoke and the keys are served; the rest stay 404.
* **`/mcp`** checks the token with `requireMcpAuth` (signature, issuer, audience `/mcp`, expiry), then that its account may still be signed in, on every request. An open instance still lets a client without a token in, as no one.
* **The sender** of a client's notes is its account's, from the identity provider.
* **The MCP sign-in through a provider** (`/api/oidc/start` with the authorize fields) goes: a provider signs a person in like any sign-in, and the login page brings them back to the authorize page.
* **The instance password** (no accounts, `PUBLIC_URL` set): Better Auth runs for its OAuth server alone, its sign-in, passkey and account routes closed. One Better Auth user, with no name and an address under `instance.notefeed.invalid`, stands for the instance; the authorize page asks for the password (the failed-attempt limit applies), and a session of that user, never sent to the browser, answers the consent. Its address carries a fingerprint of the password's key, so a changed password makes a new user at start-up: the old one goes with its clients' grants, and the signing keys (sealed with the secret, which changes with the password) are made afresh. `/mcp` takes a token only for the current instance user, or the password as a bearer.
* **notefeed's own server goes** (`backend/oauth`, `/oauth/register`, `/oauth/token`). Without `PUBLIC_URL`, a password-locked instance has no OAuth, only the password as a bearer.

### Consequences

* Good, because notefeed has no OAuth code of its own any more, and clients get standard discovery, registration and refresh.
* Good, because a removed account or a person taken off the allow-list loses MCP at the next call, not at the next refresh.
* Bad, because the server keeps state: clients, consents and refresh tokens in `accounts.sqlite` (and the JWT signing keys), where notefeed's own kept none.
* Bad, because a user that is no person sits among the accounts' users on a password-locked instance; it never has accounts and is told apart by its address.
* Bad, because an MCP client's access no longer ends 90 days after the sign-in (ADR 0056): a refresh token lasts 30 days from its last use, so a client in use keeps working until the account is deleted or its person leaves the allow-list.
* Bad, because every connected client logs in once more after the upgrade, and the password's OAuth login now needs `PUBLIC_URL` and keeps `accounts.sqlite` on an instance without accounts.

This supersedes ADR 0060's choice of notefeed's server for accounts and the OAuth server of ADR 0007, and amends ADR 0058.
