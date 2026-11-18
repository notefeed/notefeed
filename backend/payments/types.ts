// What notefeed needs from a payment provider (ADR 0029, ADR 0061): the plans it sells (ADR 0035), a checkout for some units of one, changing
// the units, the subscription as it stands, the customer portal, the provider's webhook turned into events, and a way to end a subscription. Everything provider-specific stays behind this; backend/licenseflow.ts is the only caller.

/** What a webhook says about a subscription (ADR 0061). `providerRef` is the provider's subscription id; `validUntil` is when the
 *  paid period ends (ms). */
export type LicenseEvent =
  /** Bought: `account` (the notefeed account the checkout was for) has this subscription of `units` from now on. */
  | { type: "started"; providerRef: string; account: string; customerRef: string | null; period: LicensePeriod; units: number; validUntil: number | null }
  /** Paid again, or changed: the period is extended; `units` when the provider says how many. */
  | { type: "renewed"; providerRef: string; validUntil: number | null; units?: number }
  /** The buyer cancelled: it stays active until `validUntil`. */
  | { type: "cancelled"; providerRef: string; validUntil: number | null }
  /** The period ended without payment. `periodEnd` is when that period ended, if the provider says. */
  | { type: "ended"; providerRef: string; periodEnd: number | null }
  /** Refunded or disputed. `full`: the whole subscription, which lapses at once; else part of it, so its units are read again. */
  | { type: "refunded"; providerRef: string; full: boolean };

import type { LicensePeriod, Plan } from "@/shared/plans";

export type { LicensePeriod, Plan };

export class WebhookRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookRejectedError";
  }
}

/** A subscription as the provider holds it now. */
export type ProviderSubscription = { units: number; active: boolean; validUntil: number | null; customerRef: string | null; period: LicensePeriod };

export interface PaymentProvider {
  /** The plans sold, monthly then yearly, as the provider holds them: name, description, price. Never throws: a provider that
   *  cannot be read gives what it gave last, or none. */
  plans(): Promise<Plan[]>;
  /** The URL to send the buyer to, for `units` of the plan of `period`, bought for `account` (the provider hands it back on the
   *  `started` event). Throws when the provider has no product for the period. */
  createCheckout(o: { successUrl: string; period: LicensePeriod; units: number; account: string }): Promise<{ url: string }>;
  /** Changes how many units a subscription has: `raise` charges the difference now, `lower` takes effect without a refund. */
  changeUnits(providerRef: string, units: number, how: "raise" | "lower"): Promise<void>;
  /** The subscription as it stands, or null for a reference that is none. */
  subscription(providerRef: string): Promise<ProviderSubscription | null>;
  /** The provider's customer portal for that customer: cancelling, the payment method, invoices. Only for the account that bought. */
  portalUrl(customerRef: string): Promise<string>;
  /** Verifies the signature over the raw body and returns the events it holds (none for an event kind notefeed does not use).
   *  Throws WebhookRejectedError for a bad signature or a body that is not the provider's. */
  parseWebhook(rawBody: string, headers: Headers): Promise<LicenseEvent[]>;
  /** Ends the subscription at once: a refunded one is not charged again, nor one whose account is deleted. Nothing to do for a
   *  reference that is no subscription. */
  cancel(providerRef: string): Promise<void>;
}
