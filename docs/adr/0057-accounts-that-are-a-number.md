---
status: accepted
date: 2026-11-14
decision-makers: Marcel Bruckner
---

# Accounts that are a number, not a person

## Context and Problem Statement

notefeed has had no accounts: access comes from knowing a feed's name and its password (ADR 0001, ADR 0008). That one gap kept coming back:

* one purchase can't cover several feeds (#292)
* the license key became a master secret (#297, #316)
* posting to several feeds has no single proof of write access (#347)
* a person's feeds are remembered per browser only (ADR 0030)

An account fixes these for the people who post. Who is an account, and what does it hold, without notefeed starting to know people (V2)? Tracking issue #387.

## Decision Drivers

* Nothing about who holds an account: no e-mail address, no name (V2), on notefeed.me above all.
* Optional: feeds keep working without one (V12), and accounts are off on an own instance unless turned on.
* No sign-in code of our own (conventions: Sign-in, Better Auth), on the file sign-in already uses (ADR 0055).
* A way back in that needs no mail.

## Considered Options

* Accounts with an e-mail address and password.
* Better Auth's `anonymous` plugin (a guest that upgrades later).
* A generated account number with a recovery key and passkeys (chosen; Mullvad's model).

## Decision Outcome

Chosen: a generated number, because it gives an account to people who post without storing anything about them.

* **The account:** Better Auth's `username` plugin holds a generated 16-digit account number (shown `4821-0937-5521-7764`). Its password is a generated 25-character recovery key, shown once.
* **No identity stored:** the e-mail field Better Auth requires is a placeholder (`<number>@accounts.invalid`) and the name is empty, so notes posted by such an account carry no sender of their own.
* **Passkeys** (`@better-auth/passkey`) are added while signed in.
* **Who makes accounts:** only notefeed's own "create account" (where accounts are `open`, ADR 0058) or the operator's endpoint. Better Auth's e-mail routes stay outside what a browser can reach.
* **The way back in** is the number and the key. Lose both and every passkey, and the account is gone.

An account made through an identity provider (ADR 0014, ADR 0055) is an account too: it keeps the provider's name as its sender, and the allow-list is re-checked on every request (ADR 0056). A number account answers to no allow-list.

### Consequences

* Good, because an account is personal data of nobody: no breach can tell who holds it.
* Good, because there is no mail to send and no mailbox that opens the account.
* Bad, because a lost number and key can't be recovered by notefeed. Recovery through the payment provider's buyer e-mail is a follow-up.
* Bad, because passkeys are bound to `PUBLIC_URL`'s host: moving notefeed to another host leaves them behind.
* Neutral, because `anonymous` was ruled out by a spike: it deletes the guest when another sign-in happens in the same browser, and an anonymous user can sign in again only by passkey.

This amends ADR 0001 (open feeds by name: an account is now possible, never needed), ADR 0008 (feed passwords), ADR 0014 (sign-in through a provider creates an account) and ADR 0030 (remembered feeds; the account's own feeds follow with feed owners).
