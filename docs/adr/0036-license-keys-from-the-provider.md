---
status: accepted
date: 2026-10-21
decision-makers: Marcel Bruckner
---

# License keys from the payment provider

## Context and Problem Statement

ADR 0029 made the license key in notefeed: 128 random bits, carried through the checkout as a hash, shown once on the success page. notefeed keeps only the hash, so a lost key could not be recovered; at best the buyer was refunded. A buyer who cannot use what they paid for and cannot get help is the usual reason for a chargeback, and Creem charges 25 EUR for each, on a 1.99 EUR sale (issue #218). Creem issues license keys itself: one per purchase, in the receipt e-mail and in its customer portal.

## Considered Options

* Keep notefeed's key, and add a support process that issues a new key for a subscription the buyer names.
* The provider's key: notefeed stores its hash, the buyer finds it again in the receipt or the portal (chosen).

## Decision Outcome

Chosen: the provider's key. A lost key is found again by the buyer alone, without writing to us; nothing about the buyer is stored that was not before.

* **The checkout** carries nothing of the key. The buyer comes back to `/license?checkout_id=…`; the page asks `POST /api/licenses/key {"checkout"}`, which reads the checkout from the provider (`PaymentProvider.checkoutKey`, Creem's `GET /v1/checkouts`) and answers its key, or 404 while it is not completed, so the page asks again for about 20 seconds. Whoever has the checkout's id may see its key, as anyone with the success URL could before.
* **The webhook**: Creem's `checkout.completed` holds the key in `license_keys` (the first; one is issued per unit, and notefeed sells one). The `started` event carries the key and notefeed stores its hash. A completed checkout without a key is rejected: the product is missing Creem's license key feature.
* **The products** carry Creem's license key delivery with no expiry and no activation limit: notefeed keeps the period from the webhooks and moves a key between feeds itself, and does not call Creem's activation API.
* **The key's format** is Creem's (`ABCDE-FGHIJ-…`), which the existing check (`[A-Za-z0-9_-]{22,64}`) accepts.

### Consequences

* Good, because a lost key is in the buyer's receipt and portal, so the case that ends in a dispute is mostly gone.
* Good, because notefeed stores what it stored before: the key's hash and the subscription id.
* Bad, because notefeed's server now sees the key once, from the provider, where before it saw only the hash; it is not kept.
* Bad, because the success page depends on the provider answering for the checkout; when it does not, the page says the key is in the receipt.
