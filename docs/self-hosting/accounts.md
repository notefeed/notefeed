# Accounts

An account is a number, not a person: a generated **account number** with a **recovery key** and, if its holder adds them, **passkeys**. It holds no e-mail address and no name. Accounts are optional, and off unless you turn them on. Feeds, read links, feed passwords and scripts work without one.

## Turning them on

`NOTEFEED_ACCOUNTS` says who may create an account:

| Value | Who creates accounts | The instance |
|---|---|---|
| `off` (default) | nobody | as before |
| `open` | anyone, on the [create page](#creating-one) | stays open: feeds work without an account |
| `provider` | your [identity provider](sign-in/index.md), for the people its allow-list lets in | locked: every page needs a sign-in |
| `closed` | you, the operator, [over the API](#the-operators-accounts) | locked: every page needs a sign-in |

Unset with an identity provider configured (`NOTEFEED_OIDC_*`) means `provider`, so an instance with sign-in keeps working as it did. Accounts need `PUBLIC_URL` and `NOTEFEED_SECRET`.

!!! warning "Never together with the instance password"
    notefeed refuses to start with `NOTEFEED_PASSWORD` and accounts both set. An identity provider counts as accounts. Pick one: the instance password for one person, accounts for several. `closed` with an identity provider doesn't start either: its sign-ins would create accounts (use `provider` or `open`).

!!! note "Scripts and MCP clients"
    With `open`, scripts and MCP clients work as on any open instance, and [feed passwords](../using/feed-passwords.md) protect single feeds. With `provider` or `closed` the instance is locked and has no instance password: scripts can't post to it yet, and MCP clients connect only through an identity provider (`provider`), until accounts get tokens for scripts and their own MCP sign-in.

## Creating one

With `open`, the login page links to **Create an account**. notefeed shows the new account number (`4821-0937-5521-7764`) and the recovery key (`K7QX2-…`, 25 characters) once, each with a copy button, and goes on only after **I saved them**. Creating accounts is limited to 10 an hour per client address (off with `NOTEFEED_RATE_LIMIT=0`); the address is never written down.

## Signing in

On the login page:

- with the account number and the recovery key, as typed (spaces and dashes in the number don't matter)
- with a passkey added on the account page
- through the identity provider, on an instance that has one

Wrong keys count toward the failed-attempt limit, like wrong passwords. With `provider`, number accounts don't sign in: every account comes from the identity provider. A sign-in renews while it is used and ends after 30 days unused, and 90 days after signing in at the latest ([ADR 0056](https://github.com/notefeed/notefeed/blob/main/docs/adr/0056-sign-ins-renew-while-used.md)).

**The account page** (**Account** in the ⓘ menu) shows the number, adds and removes passkeys, makes a new recovery key (the old one stops working at once, and every other session of the account ends), logs out, and deletes the account after its number is typed again. Adding or removing a passkey, a new key and deleting need a sign-in from the last day, so a stolen session cookie alone can't lock the holder out.

!!! note "Passkeys belong to `PUBLIC_URL`'s host"
    A passkey works only on the host it was made on. Moving notefeed to another host name (a changed `PUBLIC_URL`) leaves every passkey behind: people sign in with their number and key, and add new ones.

## Lost accounts

The number and the key are the way back in. Lose both and every passkey, and the account is gone: notefeed has no e-mail address to send a reset to and can't tell who held it. You can delete it as the operator; nothing can open it again.

## The operator's accounts

With `NOTEFEED_OPERATOR_TOKEN` set (32 characters or more), with accounts `open` or `closed`:

```sh
# a new account: its number and recovery key, once; hand them to the person
curl -X POST -H "Authorization: Bearer $NOTEFEED_OPERATOR_TOKEN" https://notes.example.com/api/operator/accounts

# delete one by its number
curl -X DELETE -H "Authorization: Bearer $NOTEFEED_OPERATOR_TOKEN" "https://notes.example.com/api/operator/accounts?number=4821093755217764"
```

With `provider` every account comes through the identity provider: creating one this way is refused with `409`.

## What is stored

In `accounts.sqlite` (`NOTEFEED_ACCOUNTS_DB`, apart from the notes on every storage backend):

- the account number
- a hash of the recovery key
- each passkey's public key, its name and when it was added
- the sessions, without the browser's address or user agent

The e-mail field the sign-in library needs holds a placeholder, `<number>@accounts.invalid`. An account made through an identity provider holds what [sign-in keeps](sign-in/index.md#the-sender) instead. Back the file up with your data ([Backups](backups.md)).
