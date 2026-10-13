// A provider that charges nobody, for the tests and for trying the flow on a development instance (NOTEFEED_PAYMENT_PROVIDER=fake).
// The checkout is the success page itself; the webhook is JSON that already is a list of events, signed with HMAC-SHA256 in
// `x-fake-signature` using NOTEFEED_FAKE_WEBHOOK_SECRET.
import { createHmac, timingSafeEqual } from "node:crypto";
import { WebhookRejectedError, type LicenseEvent, type PaymentProvider } from "./types";

export const fakeSignature = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("hex");

export function createFake(webhookSecret: string): PaymentProvider {
  return {
    async createCheckout({ successUrl }) {
      return { url: successUrl };
    },
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
  };
}
