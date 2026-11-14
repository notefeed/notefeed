---
status: accepted
date: 2026-11-14
decision-makers: Marcel Bruckner
---

# Sign-in runs on Better Auth in a file of its own; the sender is a label any post can set

## Context and Problem Statement

notefeed is getting optional accounts that are a number, not a person: an account holds a person's feeds and license on every device, with no e-mail and no name (the accounts design, issues #292, #297, #347). The first step is the ground they stand on. Sign-in through an OpenID Connect provider (ADR 0014) was a relying party written by hand (`backend/oidc/flow.ts`), and the signed-in person was a signed cookie, `nf_identity`, with no record behind it. The engineering conventions rule out hand-written sign-in code (conventions: Sign-in, Better Auth). Where does sign-in run, where are its records kept, and what does that make of the sender, which only a sign-in could set?

## Decision Drivers

* No sign-in, session or OAuth code of our own where a maintained library does it (conventions: Sign-in).
* Sessions and tokens never sit next to notes, on any storage backend (ADR 0023), and a restore of the content can't change who may sign in.
* Nothing stored about a person beyond what sign-in needs (V2); on notefeed.me sign-in stays off in this step.
* Own instances keep working as before, apart from what can't stay.
* Everything in the REST API, both clients and MCP (V11).

## Considered Options

* Keep the hand-written relying party and the `nf_identity` cookie.
* Better Auth with its tables in the instance's own database (the content store).
* Better Auth in a SQLite file of its own, `accounts.sqlite`, on every storage backend (chosen).

## Decision Outcome

Chosen: Better Auth in its own file, because it removes our own sign-in code, keeps sessions apart from notes on every backend, and is where accounts will live. Its precedent is `licenses.db`, already a SQLite file beside PostgreSQL on notefeed.me (ADR 0029).

* **The file.** `NOTEFEED_ACCOUNTS_DB`, default `DATA_DIR/accounts.sqlite`, created and migrated at start-up only while a provider is configured. Better Auth is built only then; its routes are `/api/auth/*`.
* **Providers.** Each `NOTEFEED_OIDC_[<NAME>_]*` set is a Better Auth generic OAuth provider (`default`, or the name in lower case): discovery, the code flow with PKCE, state and nonce, the id_token checked against the provider's keys. notefeed's own rules stay in `backend/accounts/providers.ts`: the allow-list (`*`, addresses, `@domain`; a verified email except for `*`) and the sender claim order, read from the id_token's claims only, as before. A refusal logs its reason under `oidc`, never who; Better Auth's own lines go to the log as `better-auth`.
* **Stricter than Better Auth's defaults.** No e-mail sign-up or sign-in (`disabledPaths`). Its secret is derived from `NOTEFEED_SECRET` and the instance password, so changing either signs everyone out, as before. A session lasts 7 days from signing in and is not extended by use, so taking someone off the allow-list ends their access within that time. None of the provider's tokens is stored: the id_token holds the person's claims and notefeed never uses them. A person without an email claim (allowed by `*`) gets a placeholder address.
* **The session replaces `nf_identity`.** `sessionOk`, `authorize` and `sender` read Better Auth's session (with its signed cookie cache, so the proxy needs no database read per request), under the same rules: only from this instance's own pages, never with an `Authorization` header. Logout ends the session in the file too.
* **MCP.** The OAuth server for MCP clients stays notefeed's (ADR 0007). Its authorize page signs in through Better Auth and then issues its own code carrying the sender, as before; `/api/oidc/start` keeps its requests and `/api/oidc/finish` is where Better Auth sends the browser back.
* **The sender is a label.** A post can carry its own sender: `X-Note-Sender`, `sender` on MCP `post_note`, `post_file` and `edit_note`, in `PATCH` and in both clients and CLIs, and a **Sender** field in the compose box. It is one line of at most 100 characters, like a title, and wins over the signed-in name; without one, a note posted signed in carries that name as before. "Show who posted" is offered on every instance, since any note can carry a sender. The stored `sender` field is unchanged, so no note is migrated.

This amends ADR 0014: sign-in keeps people in `accounts.sqlite` (their name and e-mail address from the provider, the provider's id for them, their sessions), and the sender is no longer verified.

### Consequences

* Good, because no sign-in code of our own is left except the MCP OAuth server, which accounts will replace later.
* Good, because sessions can be ended (logout, deleting a person) and expire on their own, without changing the secret.
* Good, because any script, assistant or person can say who posted a note, signed in or not.
* Bad, because the redirect URI changes to `<PUBLIC_URL>/api/auth/callback/<provider>`: an operator must register it at the provider before upgrading, and everyone signs in once more. The upgrade notes say so.
* Bad, because an instance with sign-in now keeps a record per person, which its privacy page has to name, and a file more to back up.
* Bad, because a reader can no longer tell a provider-verified sender from a typed one.

### Confirmation

`backend/accounts/auth.test.ts` (the file, closed e-mail sign-up), `backend/oidc/routes.test.ts` against a real OIDC provider on loopback (`oauth2-mock-server`: sign-in, the allow-list, the sender claim, failures and their logs, the failed-attempt limit, MCP, several providers, the 7 days, no tokens stored), the session tests in `backend/auth.test.ts`, `backend/http/session.test.ts` and `proxy.test.ts`, the sender on every route in `backend/http/notes.test.ts`, `edit.test.ts`, `backend/mcp.test.ts` and both client packages, and the compose box in `e2e/notes.spec.ts`.
