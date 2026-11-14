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
    A script acts as an account with an [account token](#account-tokens), and an MCP client signs in as one on its authorize page ([MCP](../integrations/mcp.md#as-an-account)), in every mode. With `open`, they also work without one, as on any open instance, and [feed passwords](../using/feed-passwords.md) protect single feeds.

## Creating one

With `open`, the login page links to **Create an account**. notefeed shows the new account number (`4821-0937-5521-7764`) and the recovery key (`K7QX2-…`, 25 characters) once, each with a copy button, and goes on only after **I saved them**. Creating accounts is limited to 10 an hour per client address (off with `NOTEFEED_RATE_LIMIT=0`); the address is never written down.

## Signing in

On the login page:

- with the account number and the recovery key, as typed (spaces and dashes in the number don't matter)
- with a passkey added on the account page
- through the identity provider, on an instance that has one

Wrong keys count toward the failed-attempt limit, like wrong passwords. With `provider`, number accounts don't sign in: every account comes from the identity provider. A sign-in renews while it is used and ends after 30 days unused, and 90 days after signing in at the latest ([ADR 0056](https://github.com/notefeed/notefeed/blob/main/docs/adr/0056-sign-ins-renew-while-used.md)).

**The account page** (**Account** in the ⓘ menu) shows the number, adds passkeys (each with an optional name of its holder's choosing) and removes them, makes a new recovery key (the old one stops working at once, and every other session of the account ends), logs out, and deletes the account after its number is typed again. Adding or removing a passkey, a new key and deleting need a sign-in from the last day, so a stolen session cookie alone can't lock the holder out.

!!! note "Passkeys belong to `PUBLIC_URL`'s host"
    A passkey works only on the host it was made on. Moving notefeed to another host name (a changed `PUBLIC_URL`) leaves every passkey behind: people sign in with their number and key, and add new ones.

## Account tokens

On the account page, **Account tokens** makes a token for a script: a name, whether it may only read or read and write, and 90 days (over the API or MCP, 1 to 365). It is shown once and starts with `nf_`. Send it as `Authorization: Bearer <token>` to the [REST API](../integrations/api.md), or set `NOTEFEED_TOKEN` for the [clients and CLIs](../integrations/clients.md): the script acts as the account, creates its feeds, posts to and manages the ones it owns. A token works on the REST API only, never on MCP or as a browser's sign-in, and a `read` one is refused on anything that writes (`403`, code `read_only`). Revoke one on the account page; deleting the account revokes them all. For a script that posts to one feed, a [feed password](../using/feed-passwords.md#a-feed-with-an-owner) is the smaller key.

## Lost accounts

The number and the key are the way back in. Lose both and every passkey, and the account is gone: notefeed has no e-mail address to send a reset to and can't tell who held it. You can delete it as the operator; nothing can open it again.

## Feeds and their owners

A feed created by a signed-in account is its own, and an existing one can be claimed: see [A feed with an owner](../using/feed-passwords.md#a-feed-with-an-owner). Deleting an account deletes the feeds it owns first, then the account. A feed whose owner's account is gone (a deletion stopped halfway, or a restore of the notes without `accounts.sqlite`) can't be claimed by anyone. You decide about it:

```sh
# give it to an account, by its number (or take its owner away with null)
curl -X PUT -H "Authorization: Bearer $NOTEFEED_OPERATOR_TOKEN" -d '{"number": "4821-0937-5521-7764"}' "https://notes.example.com/api/operator/feeds?feed=<name>"

# delete it with everything in it
curl -X DELETE -H "Authorization: Bearer $NOTEFEED_OPERATOR_TOKEN" "https://notes.example.com/api/operator/feeds?feed=<name>"
```

The owner's notes posted without a sender of their own show the feed's **Your name on your notes** setting, which only the owner sets: see [Sender](../using/posting.md#sender).

With `open`, an account older than 30 days that owns no feed and has no license is deleted (once a day), so accounts made and forgotten don't pile up. Accounts you or an identity provider made stay.

The owner is stored with the feed, encrypted with its key on an encrypted database ([Storage](storage.md)), never in `accounts.sqlite`.

## The operator's accounts

With `NOTEFEED_OPERATOR_TOKEN` set (32 characters or more), with accounts `open` or `closed`:

```sh
# a new account: its number and recovery key, once; hand them to the person
curl -X POST -H "Authorization: Bearer $NOTEFEED_OPERATOR_TOKEN" https://notes.example.com/api/operator/accounts

# delete one by its number
curl -X DELETE -H "Authorization: Bearer $NOTEFEED_OPERATOR_TOKEN" "https://notes.example.com/api/operator/accounts?number=4821093755217764"
```

With `provider` every account comes through the identity provider: creating one this way is refused with `409`.

Where licenses are sold, a subscription the payment provider already has (bought before licenses were on accounts, or by hand) is put on an account by its number:

```sh
curl -X POST -H "Authorization: Bearer $NOTEFEED_OPERATOR_TOKEN" -d '{"number": "4821-0937-5521-7764", "subscription": "sub_…"}' https://notes.example.com/api/operator/subscriptions
```

## What is stored

In `accounts.sqlite` (`NOTEFEED_ACCOUNTS_DB`, apart from the notes on every storage backend):

- the account number
- a hash of the recovery key
- each passkey's public key, the name its holder gave it (optional, such as `Work laptop`), when it was added, and the kind of passkey store that made it (its AAGUID: iCloud Keychain, 1Password and the like, never the person or the device), shown to tell passkeys apart
- the sessions, without the browser's address or user agent
- each account token's hash, its name, scope, end and when it was last used
- where licenses are sold: each subscription's reference at the payment provider, its customer reference there, how many feeds it covers, its period and end; nothing about the buyer
- when the account was made, for the 30-day cleanup above

The e-mail field the sign-in library needs holds a placeholder, `<number>@accounts.invalid`. An account made through an identity provider holds what [sign-in keeps](sign-in/index.md#the-sender) instead. Back the file up with your data ([Backups](backups.md)).
