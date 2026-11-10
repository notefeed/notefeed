---
status: accepted
date: 2026-11-10
decision-makers: Marcel Bruckner
---

# Creem through its own packages

## Context and Problem Statement

notefeed talked to Creem (ADR 0029, 0036) through a module of its own: the HTTP calls for the products, the checkout and the cancel, the webhook's signature check, and its own types for Creem's answers and deliveries. Creem publishes official packages for all of this, MIT licensed. Issue #339 decided to use them and keep only what a delivery means for a license. Which packages, and where does each one stop?

## Considered Options

* **`creem` (the SDK) for the API, `@creem_io/webhook-types` for the signature and the deliveries, a few lines of our own for the route** (chosen).
* **`@creem_io/nextjs`'s `Webhook` handler as the route**, as #339 planned: it verifies the signature and calls one callback per delivery. It writes every completed checkout to the console, the buyer's e-mail address, name and license key included, which would reach the server's log and Loki (V2), and it compares the signature in variable time.
* **Keep the module of our own:** no new dependencies, but every change at Creem is ours to follow, with types nobody else checks.

## Decision Outcome

Chosen: the SDK and the delivery types; `backend/payments/creem.ts` keeps the `PaymentProvider` interface, so `backend/licenseflow.ts`, its rules and the fake provider stay as they are.

* **The API through the SDK:** the products (kept five minutes, the last list while Creem is away), the checkout, a checkout's key for the success page, the cancel; test or live from the key's prefix.
* **The SDK checks every answer against its schema.** An answer it refuses counts as Creem being away: the plans keep their last list. The SDK 1.13.0 refuses every real checkout, because it wants `feature` as one object where Creem answers a list (as `@creem_io/webhook-types` has it); for a checkout's key, the answer is then read as it came, two fields checked by hand.
* **The webhook:** the signature computed with `generateSignature` and compared in constant time, the body parsed with `parseWebhookEvent`, the deliveries typed by `@creem_io/webhook-types`. Nothing of a delivery is logged.
* **What each delivery does:** `checkout.completed` starts the license with Creem's key; `subscription.active` and `subscription.paid` extend it; `subscription.canceled`, `subscription.scheduled_cancel` and `subscription.paused` keep it to the end of the paid period (a pause ended nothing before either: nothing renewed, so the license ran out with its period; #339 had it end the license at once, which would take a period already paid for); `subscription.expired` and `subscription.unpaid` end it; `refund.created` and `dispute.created` end it at once, and the subscription is cancelled at Creem.
* **The checkout opens over the license page** with `@creem_io/embed`; paid, it comes back to the license page with the checkout's id, as the redirect did. The webhook alone decides the license. The embed keeps a `creem_ref` affiliate token in the browser only when the page was opened with one; notefeed has no affiliate program.

### Consequences

* Good, because Creem's changes to its API reach notefeed as a package update, typed.
* Good, because the webhook logs nothing of a delivery, so no buyer's data reaches the log (V2).
* Bad, because the SDK's schema can lag behind Creem's answers, as `feature` does: a refused answer costs the plans' refresh or the success page's key (the key is also in Creem's receipt) until the SDK is fixed.
* Bad, because the SDK brings a second MCP SDK (version 1, beside notefeed's own) along as a dependency, which the install grows by.
