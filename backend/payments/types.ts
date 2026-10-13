// What notefeed needs from a payment provider (ADR 0029): a checkout to send the buyer to, and the provider's webhook turned into
// events about a license. Everything provider-specific stays behind this; backend/licenseflow.ts is the only caller.

/** What a webhook says about a license. `providerRef` is the provider's subscription id; `validUntil` is when the paid period ends (ms). */
export type LicenseEvent =
  /** Bought: the license with this key hash exists from now on. */
  | { type: "started"; providerRef: string; keyHash: string; validUntil: number | null }
  /** Paid again: the period is extended. */
  | { type: "renewed"; providerRef: string; validUntil: number | null }
  /** The buyer cancelled: it stays active until `validUntil`. */
  | { type: "cancelled"; providerRef: string; validUntil: number | null }
  /** The period ended without payment. */
  | { type: "ended"; providerRef: string }
  /** Refunded or disputed: lapses at once. */
  | { type: "refunded"; providerRef: string };

export class WebhookRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookRejectedError";
  }
}

export interface PaymentProvider {
  /** The URL to send the buyer to. `keyHash` is carried through the provider and comes back in the `started` event. */
  createCheckout(o: { keyHash: string; successUrl: string }): Promise<{ url: string }>;
  /** Verifies the signature over the raw body and returns the events it holds (none for an event kind notefeed does not use).
   *  Throws WebhookRejectedError for a bad signature or a body that is not the provider's. */
  parseWebhook(rawBody: string, headers: Headers): Promise<LicenseEvent[]>;
}
