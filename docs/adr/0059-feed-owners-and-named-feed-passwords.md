---
status: accepted
date: 2026-11-14
decision-makers: Marcel Bruckner
---

# A feed's owner, and several named feed passwords

## Context and Problem Statement

A feed had at most one password, and whoever knew it could change it (ADR 0008, ADR 0044). Sharing a feed meant sharing that one password; taking one person's access away meant a new password for everyone. Accounts (ADR 0057) give a feed someone to belong to. How does a feed get an owner, what may only the owner do, and how are several passwords kept without a second store? Issue #389.

## Considered Options

* One shared password plus per-feed account tokens for each person or script.
* A new "feed key" concept next to the password.
* Several named feed passwords on an owned feed (chosen).

## Decision Outcome

Chosen: several named passwords, because they are one credential doing one job: the only difference to today is who manages them.

* **The record.** The value the storage keeps for a feed's password (the `.password` file, the `password_hash` column, sealed with the feed's key on an encrypted database, V4) becomes the feed's record:
  * its owner, an account id
  * its passwords, each with an id, a name, its scrypt hash and when it was added
  * A bare hash from before reads as one password named "Feed password", and a feed that is still only that is written back the same way. Existing feeds, scripts and unlock cookies don't change, and no migration runs.
* **An owner, one per feed.** A feed created by a signed-in account, or made by its post, is the account's. An existing feed is claimed with one of its passwords, or, when open, by giving it a password, as ADR 0044 protects one. An owned feed can't be claimed.
* **What only the owner does:**
  * add (generated, shown once) and revoke passwords
  * rename the feed
  * delete it
  * The single-password change and the license-key recovery (ADR 0037) are refused on an owned feed.
* **The owner's account opens the feed** without a password. Each password's unlock cookie is made from its own hash, so revoking a password ends the browsers it unlocked.
* **An account's feeds** are found by reading every feed's record, since the owner is sealed and the storage can't be asked. The result is kept for a minute and dropped at each change this process makes.
* **Deleting an account** deletes its feeds first. A feed whose owner's account is gone can't be claimed; the operator gives it to an account or deletes it (`/api/operator/feeds`).

* **The owner's sender name.** A note the owner's account posts without a sender of its own stores the mark `by: owner`, never an account id. It shows the feed's sender name as it is now, set by the owner only, or else the name the account has from its identity provider. A sender given with a note is stored as given, and a note by anyone else carries no owner's name.
* **Reserved feeds** (ADR 0012) belong to `NOTEFEED_OPERATOR_ACCOUNT` on an instance with accounts. They are created open, for the owner to give passwords, and `NOTEFEED_RESERVED_PASSWORD` is not used there. Without that account none are created: an open reserved feed nobody owns would be anyone's.
* **Accounts nobody uses.** With `open`, an account older than 30 days that owns no feed is deleted, once a day.

### Consequences

* Good, because one person's or one script's access ends without touching anyone else's.
* Good, because nothing new is stored where it wasn't: the record sits where the hash sat, sealed the same way.
* Bad, because a wrong password is checked against every password of the feed (one scrypt each).
* Neutral: the operator's usage metrics count a feed as protected only when it has a password, without opening the sealed record: the database keeps a plain flag beside it (migration `009_feed_protected`), which tells the operator no more than the count already did.
* Neutral, because the account's own steps over the API need a session from this instance's pages until account tokens exist (#390).

This amends ADR 0008 and ADR 0044.
