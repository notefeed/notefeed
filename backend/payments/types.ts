// What notefeed needs from a payment provider (ADR 0029): the plans it sells (ADR 0035), a checkout to send the buyer to, the license key it issued for
// that checkout, the provider's webhook turned into events about a license, a link to the provider's page for the buyer, and a way to end a subscription. Everything provider-specific stays behind this; backend/licenseflow.ts is the only caller.

/** What a webhook says about a license. `providerRef` is the provider's subscription id; `validUntil` is when the paid period ends (ms). */
export type LicenseEvent =
  /** Bought: the license with this key, which the provider issued, exists from now on. */
  | { type: "started"; providerRef: string; key: string; validUntil: number | null }
  /** Paid again: the period is extended. */
  | { type: "renewed"; providerRef: string; validUntil: number | null }
  /** The buyer cancelled: it stays active until `validUntil`. */
  | { type: "cancelled"; providerRef: string; validUntil: number | null }
  /** The period ended without payment. `periodEnd` is when that period ended, if the provider says. */
  | { type: "ended"; providerRef: string; periodEnd: number | null }
  /** Refunded or disputed: lapses at once. */
  | { type: "refunded"; providerRef: string };

import type { LicensePeriod, Plan } from "@/shared/plans";

export type { LicensePeriod, Plan };

export class WebhookRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookRejectedError";
  }
}

export interface PaymentProvider {
  /** The plans sold, monthly then yearly, as the provider holds them: name, description, price. Never throws: a provider that
   *  cannot be read gives what it gave last, or none. */
  plans(): Promise<Plan[]>;
  /** The URL to send the buyer to; after paying, the buyer comes back to `successUrl` with the checkout's id in `checkout_id`.
   *  `period` picks the product; throws when the provider has none for it. */
  createCheckout(o: { successUrl: string; period: LicensePeriod }): Promise<{ url: string }>;
  /** The license key issued for a completed checkout, the same one the `started` event carries; null while it is not completed, or
   *  for a checkout that is none. */
  checkoutKey(checkoutId: string): Promise<string | null>;
  /** Verifies the signature over the raw body and returns the events it holds (none for an event kind notefeed does not use).
   *  Throws WebhookRejectedError for a bad signature or a body that is not the provider's. */
  parseWebhook(rawBody: string, headers: Headers): Promise<LicenseEvent[]>;
  /** The provider's own page for the buyer of this license: cancelling, the payment method, the invoices. A link that works for a while. */
  portalUrl(providerRef: string): Promise<{ url: string }>;
  /** Ends the subscription at once, so that a refunded one is not charged again. Nothing to do for a reference that is no subscription. */
  cancel(providerRef: string): Promise<void>;
}
