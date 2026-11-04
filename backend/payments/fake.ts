// A provider that charges nobody, for the tests and for trying the flow on a development instance (NOTEFEED_PAYMENT_PROVIDER=fake).
// It sells a monthly and a yearly plan at fixed prices. The checkout is the success page itself, with a made-up checkout id whose
// key is derived from it (fakeKey), so every route can tell it without shared state; the webhook is JSON that already is a list of
// events, signed with HMAC-SHA256 in `x-fake-signature` using NOTEFEED_FAKE_WEBHOOK_SECRET.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { WebhookRejectedError, type LicenseEvent, type PaymentProvider } from "./types";

export const fakeSignature = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("hex");

/** The key the fake provider issues for a checkout. */
export const fakeKey = (secret: string, checkoutId: string) => createHmac("sha256", secret).update(`key ${checkoutId}`).digest("base64url").slice(0, 22);

/** What `cancel` was called with, for the tests. */
export const cancelled: string[] = [];

export function createFake(webhookSecret: string): PaymentProvider {
  return {
    async plans() {
      return [
        { period: "month", name: "Monthly", description: "", amount: 199, currency: "EUR", taxIncluded: true },
        { period: "year", name: "Yearly", description: "", amount: 1990, currency: "EUR", taxIncluded: true },
      ];
    },
    async createCheckout({ successUrl }) {
      return { url: `${successUrl}?checkout_id=fake_${randomBytes(9).toString("base64url")}` };
    },
    async checkoutKey(checkoutId) {
      return checkoutId.startsWith("fake_") ? fakeKey(webhookSecret, checkoutId) : null;
    },
    accountUrl: "https://fake.invalid/my-orders",
    async parseWebhook(rawBody, headers) {
      const a = Buffer.from(headers.get("x-fake-signature") ?? "");
      const b = Buffer.from(fakeSignature(webhookSecret, rawBody));
      if (a.length !== b.length || !timingSafeEqual(a, b)) throw new WebhookRejectedError("bad signature");
      try {
        const events = JSON.parse(rawBody) as LicenseEvent[];
        if (Array.isArray(events)) return events;
      } catch {}
      throw new WebhookRejectedError("not a list of events");
    },
    async cancel(providerRef) {
      cancelled.push(providerRef);
    },
  };
}
