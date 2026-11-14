// A provider that charges nobody, for the tests and for trying the flow on a development instance (NOTEFEED_PAYMENT_PROVIDER=fake).
// It sells a monthly and a yearly plan at fixed prices. The checkout is the success page itself, with a made-up checkout id; the webhook
// is JSON that already is a list of events, signed with HMAC-SHA256 in `x-fake-signature` using NOTEFEED_FAKE_WEBHOOK_SECRET. What a
// test changed (units, cancellations) is kept in memory, per process.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { processState } from "../state";
import { WebhookRejectedError, type LicenseEvent, type PaymentProvider, type ProviderSubscription } from "./types";

export const fakeSignature = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("hex");

/** What the fake provider was asked, for the tests: checkouts, unit changes, cancellations, and the subscriptions it knows. */
export const fake = processState("fake-payments", () => ({
  checkouts: [] as { period: string; units: number; account: string }[],
  changes: [] as { providerRef: string; units: number; how: "raise" | "lower" }[],
  cancelled: [] as string[],
  subscriptions: new Map<string, ProviderSubscription>(),
}));
export const cancelled = fake.cancelled;

export function createFake(webhookSecret: string): PaymentProvider {
  return {
    async plans() {
      return [
        { period: "month", name: "Monthly", description: "", amount: 199, currency: "EUR", taxIncluded: true },
        { period: "year", name: "Yearly", description: "", amount: 1990, currency: "EUR", taxIncluded: true },
      ];
    },
    async createCheckout({ successUrl, period, units, account }) {
      fake.checkouts.push({ period, units, account });
      // The account rides in the made-up id, so a test can send the webhook the provider would (fake only: Creem's ids carry nothing).
      const id = `fake_${Buffer.from(account).toString("base64url")}_${randomBytes(9).toString("base64url")}`;
      return { url: `${successUrl}${successUrl.includes("?") ? "&" : "?"}checkout_id=${id}` };
    },
    async changeUnits(providerRef, units, how) {
      fake.changes.push({ providerRef, units, how });
      const s = fake.subscriptions.get(providerRef);
      if (s) s.units = units;
    },
    async subscription(providerRef) {
      return fake.subscriptions.get(providerRef) ?? null;
    },
    async portalUrl(customerRef) {
      return `https://fake.invalid/portal/${encodeURIComponent(customerRef)}`;
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
    async cancel(providerRef) {
      fake.cancelled.push(providerRef);
    },
  };
}
