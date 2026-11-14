---
status: accepted
date: 2026-11-14
decision-makers: Marcel Bruckner
---

# A license belongs to an account, for as many of its feeds as its units

## Context and Problem Statement

A license covered one feed and was identified by a key (ADR 0029, ADR 0036). The key grew into more than a proof of payment:

* it reset a feed's password (ADR 0037)
* it once opened the buyer's whole provider portal (#316, ADR 0050)
* it was entered on each feed, moved by hand, and couldn't cover several feeds with one purchase (#292)

Accounts (ADR 0057) give a license somewhere to belong. How do licenses work on an account, and what becomes of the key? Issue #391.

## Considered Options

* Keep per-feed keys, and add accounts beside them.
* Licenses on a feed or on an account, both.
* Licenses only on the account, as subscriptions with units (chosen).

## Decision Outcome

Chosen: only on the account, because one model is simpler for people, for every API surface and for the code.

* **A license is the account's subscriptions** at the payment provider, kept in `accounts.sqlite` beside the accounts, in a table of notefeed's own. Their `units` added up say how many of the account's feeds it covers.
* **Which feeds** is stored with each feed, in its record (ADR 0059), sealed like its owner, so no feed name goes into `accounts.sqlite`. The owner puts a feed under the license or takes it off.
* **When there are more feeds than units** (a lapse, fewer units), the feeds put there first stay covered. Lowering goes no lower than the feeds under it, so nothing loses its cover by guesswork.
* **Buying** is a checkout for `units`, made for the account (Creem's `request_id`); the webhook puts the subscription on that account. Buying again adds a subscription.
* **Changing units:** raising charges the difference now (`proration-charge-immediately`); lowering doesn't refund (`proration-none`).
* **Refunds:** a full refund or dispute lapses the subscription and cancels it; a partial one reads the units again from the provider.
* **The provider's customer portal** opens from the account page, for the account that bought: its holder is the only one who can open the account. This reverses ADR 0050, whose reason was that a key could be handed on.
* **License keys go:**
  * no key entry and no `X-License-Key`
  * no password reset by key (ADR 0037): a feed with an owner is reached through the owner's account
  * no `licenses.db`
  * a license bought before is attached to an account by the operator (`/api/operator/subscriptions`)
* **A new feed** with a password or pictures, or made without a note where licenses are sold, needs the posting account to have a unit free, and goes under it.
* **Deleting an account** cancels its subscriptions at the provider.

### Consequences

* Good, because one purchase covers several feeds, and more or fewer later (#292).
* Good, because no secret but the account opens what was bought, and nothing about the buyer is in notefeed.
* Bad, because buying needs an account, and so does a protected feed on notefeed.me.
* Bad, because a feed without an owner whose password is lost can't be recovered by a key any more: the operator removes the password, as on an instance without licenses.

This supersedes the per-feed part of ADR 0029, and ADR 0036, 0037 and 0050; it amends ADR 0043.
