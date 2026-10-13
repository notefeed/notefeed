---
status: proposed
date: 2026-10-13
decision-makers: Marcel Bruckner
---

# Licenses: one paid license per feed, checked only when a payment provider is configured

## Context and Problem Statement

notefeed.me needs income. The decisions so far are in issue #42: the feed owner pays, on the SaaS only; readers never pay; there are no accounts and no personal data; self-hosted instances keep every feature. How is "paid" represented, what does it unlock, what happens when it ends, and how does a payment provider plug in without the rest of the code knowing which one it is?

## Considered Options

* **A license record per feed, with a random key** (chosen): bought through the provider, shown once on the checkout success page, entered in the feed's settings together with write access to the feed.
* **An account identifier that holds licenses and covers several feeds** (Mullvad style): one purchase for many feeds, but a table that links one person's feeds to each other, which notefeed does not know today. Not rejected for good: a license record can gain an owner field later.
* **Signed tokens checked locally:** no store, but renewals, lapses, refunds and moving a license need state that can change.

## Decision Outcome

Chosen: a license record per feed. Linking a license to a payment is a deterrent for casual abuse, not a barrier for a determined one (a VPN or a prepaid card defeats it); it costs an honest user nothing, which is why images are paid (#42).

* **Free feed:** created without signing up. It keeps the newest `FREE_NOTE_CAP` notes (first value 1000); at the cap the oldest note is dropped, so a write is never refused. Reading and the instance's per-IP rate limit are unchanged (#123 is the licensed rate limit).
* **Licensed feed:** no note cap, a feed password can be set, images can be uploaded.
* **Lapse:** the feed returns to the free tier and nothing is deleted. An existing feed password stays and keeps protecting the feed, but it cannot be set or changed; stored images keep being served, new uploads are refused; the note cap applies again to new notes.
* **License record:** `key` (random, 128 bits, stored as a hash), `feedId` or none, `status` (`active`, `lapsed`), `providerRef` (the provider's subscription id, which is how a webhook finds it), `validUntil`. Operations: find by key, find by feed, find by `providerRef`, and move a license to another feed atomically. Attaching needs the key and write access to the target feed; detaching needs write access only. A lost key cannot be recovered, because the buyer is unknown; the provider's receipt and portal are the way back.
* **Provider interface:** `createCheckout()` returns a URL to redirect to; `handleWebhook(request)` verifies the signature and returns events (`started`, `renewed`, `cancelled`, `refunded`) that the license store applies. The provider is chosen by configuration. **With no provider configured, the license checks are skipped and every feature is open**, so self-hosted instances are unchanged.
* **Provider:** a European merchant of record is preferred, for VAT and for the data-processing agreement. Creem is the first candidate (subscriptions, license keys, webhooks, 3.9 % + 40 ¢ in its docs); its legal entity, its acceptance of an anonymous feed host and its chargeback terms are to be confirmed before the first sale. Paddle is the fallback.
* **Price:** first value 4 EUR a month or 40 EUR a year per feed, set in the provider, not in notefeed.
* **Chargeback or refund:** the license lapses at once; the feed is not deleted.
* **Not built:** accounts, an account identifier, per-feed rate limits (#123), retention, image limits.

### Consequences

* Good, because nothing about a buyer is stored: the key is a hash, the provider holds the person.
* Good, because the provider is replaceable and the feature checks live in one place.
* Good, because a self-hosted instance cannot be locked out of a feature by a missing license.
* Bad, because a lost key cannot be recovered by notefeed.
* Bad, because one person with several feeds buys and manages several licenses.
* Bad, because the SaaS depends on the provider's webhooks being delivered; a missed one is repaired by the provider's retries and a periodic check of `validUntil`.
* To settle before the first paid license is sold: the CRA question (#42, last comment) and the support period.
