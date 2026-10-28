---
status: accepted
date: 2026-10-28
decision-makers: Marcel Bruckner
---

# A license key opens no provider page

## Context and Problem Statement

The license page had **Manage subscription**: whoever entered a key got a link into the payment provider's customer portal (`POST /api/licenses/portal`, `PaymentProvider.portalUrl`). Creem's portal belongs to the customer, not to one subscription (#316). It shows the buyer's e-mail address, payment method and invoices, and every license the buyer bought, each with its key.

So anyone holding one key, handed to a co-author, put into a script or leaked, could read the buyer's personal data (V2) and the keys of the buyer's other licenses. With another feed's key, ADR 0037 resets that feed's password: one leaked key could take over every feed the buyer licensed (V13).

## Considered Options

* Keep the portal link and tell buyers not to hand keys on.
* Cancel through notefeed, for the key's own subscription only, and no portal link.
* No provider page from a key at all; buyers sign in at the provider with their e-mail (chosen).

## Decision Outcome

Chosen: a key opens no provider page.

* **Gone:** `POST /api/licenses/portal`, `portalFor`, `PaymentProvider.portalUrl`. It was never in the public API, the clients or MCP.
* **Instead:** `PaymentProvider.accountUrl`, where buyers manage their purchases themselves. With Creem that is `https://creem.io/my-orders/login`: the e-mail address bought with, then a sign-in link by mail. The license page's *Cancel, payment and invoices* links there and asks for no key.
* **Cancelling through notefeed** was left out: a leaked key cancelling a license is a nuisance, not a leak, but nothing needs it once the buyer has the provider's own sign-in. It can come back for one subscription at a time if buyers ask for it.

### Consequences

* Good, because a key proves one feed and nothing more again (V13), and shows nobody who bought it (V2).
* Good, because licenses bought together, or by one buyer one after another, cannot be reached through each other's keys, which several licenses at once (#292) needs.
* Neutral: the key stays the buyer's for another reason now: it resets the feed's password (ADR 0037).
* Bad, because a buyer who no longer has the e-mail address bought with cannot reach their purchases; Creem's support is the way then.
