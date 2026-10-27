---
status: accepted
date: 2026-10-21
decision-makers: Marcel Bruckner
---

# Recovering a feed password with the feed's license key

## Context and Problem Statement

A feed password is stored only as a hash (ADR 0008), so a lost one can be removed only by the operator. On notefeed.me that does not work as a promise: there are no accounts, so the operator cannot tell the owner of a feed from anyone else who writes "I lost the password of feed X", and removing it on such a request would open a stranger's private feed. With PostgreSQL there is also no file to delete. Since ADR 0036 the license key comes from the payment provider and is in the buyer's receipt and portal, and a feed can only have a password while it has a license (ADR 0029). The key attached to a protected feed is therefore the one proof of owning it that the buyer can always find again.

## Considered Options

* The license key as the feed password: one secret, recoverable from the receipt.
* The license key as the way to recover the password (chosen).
* An operator command, with the license key as the proof the operator asks for.

## Decision Outcome

Chosen: the key recovers the password. The password stays what it is for, a secret to share with scripts and co-authors; the key stays the buyer's, because it also opens the provider's portal with the buyer's name, invoices and the subscription. A key used as the password would put the billing into every script, and would leave a feed unprotected when its key moves to another feed.

* **Where:** the unlock screen of a protected feed, on an instance that sells licenses, has **Forgot the password?** with the license key and a new password. It posts `action=recover` to `/<feed>/access`, the form route that already unlocks, changes and removes (same-origin only).
* **Proof:** the key must be the license attached to this feed: found by its hash, its feed must be this one. A key on another feed or on none proves nothing.
* **What it does:** with a new password, the feed gets it and this browser is unlocked for it (every earlier unlock cookie stops working); that needs an active license, like any password change. With the new password left empty, the password is removed, which a lapsed license's key may do too: it is still the buyer's proof, and the owner should not be locked out of their own notes by a lapsed subscription.
* **Abuse:** a wrong key is a failed attempt and counts against the same per-client budget as a wrong password; a bad new password is refused before the key is tried and counts nothing.
* **For scripts and agents** (added 2026-10-27): the same recovery is `POST /api/v1/feeds/{feed}/password/recover` with JSON `{key, password}`, the MCP tool `recover_feed_password` and the client packages' `recoverFeedPassword` / `recover_feed_password`; an empty or missing password removes it. Same proof, same attempt budget. Until then only the browser form could do it, and four feed passwords on notefeed.me had to be reset by replaying that form.
* **Elsewhere:** an instance without a payment provider shows nothing new; there the operator still removes a lost password (ADR 0008), now described for the SQL storage too.

### Consequences

* Good, because a lost password no longer needs the operator, and the operator never has to judge who owns a feed.
* Good, because the password and the key keep separate roles.
* Bad, because whoever holds the key can take over the feed's password. That is the buyer by design; a key given away gives the feed away, which the hosted docs say.
* Bad, because a feed whose license was detached has no key to recover with; it is an ordinary protected feed again, and only the operator can help.
