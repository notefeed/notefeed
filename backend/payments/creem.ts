// Creem (a merchant of record; https://docs.creem.io), ADR 0029. A key starting `creem_test_` talks to the sandbox. The webhook is
// signed with HMAC-SHA256 over the raw body, hex, in `creem-signature`; the same event can arrive more than once.
import { createHmac, timingSafeEqual } from "node:crypto";
import { WebhookRejectedError, type LicenseEvent, type PaymentProvider } from "./types";

export type CreemOptions = { apiKey: string; productId: string; webhookSecret: string; fetch?: typeof fetch };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const time = (v: unknown): number | null => {
  const t = typeof v === "string" || typeof v === "number" ? new Date(v).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
};

export function createCreem({ apiKey, productId, webhookSecret, fetch: doFetch = fetch }: CreemOptions): PaymentProvider {
  const base = apiKey.startsWith("creem_test_") ? "https://test-api.creem.io/v1" : "https://api.creem.io/v1";
  return {
    async createCheckout({ keyHash, successUrl }) {
      const res = await doFetch(`${base}/checkouts`, {
        method: "POST",
        headers: { "x-api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify({ product_id: productId, success_url: successUrl, request_id: keyHash, metadata: { key_hash: keyHash } }),
      });
      if (!res.ok) throw new Error(`creem: creating a checkout failed (${res.status})`);
      const url = str(obj(await res.json())?.checkout_url);
      if (!url) throw new Error("creem: the checkout has no checkout_url");
      return { url };
    },

    async parseWebhook(rawBody, headers) {
      const given = headers.get("creem-signature") ?? "";
      const want = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
      const a = Buffer.from(given);
      const b = Buffer.from(want);
      if (a.length !== b.length || !timingSafeEqual(a, b)) throw new WebhookRejectedError("bad signature");
      let event: Obj | undefined;
      try {
        event = obj(JSON.parse(rawBody));
      } catch {}
      const kind = str(event?.eventType);
      const o = obj(event?.object);
      if (!kind || !o) throw new WebhookRejectedError("not a Creem event");
      const subscription = obj(o.subscription);
      switch (kind) {
        case "checkout.completed": {
          // A one-off product has no subscription: the order is the reference then.
          const providerRef = str(subscription?.id) ?? str(obj(o.order)?.id);
          const keyHash = str(obj(o.metadata)?.key_hash) ?? str(obj(subscription?.metadata)?.key_hash);
          if (!providerRef || !keyHash) throw new WebhookRejectedError("a completed checkout without a subscription and a key hash");
          return [{ type: "started", providerRef, keyHash, validUntil: time(subscription?.current_period_end_date) }];
        }
        case "subscription.paid":
        case "subscription.active": {
          const providerRef = str(o.id);
          return providerRef ? [{ type: "renewed", providerRef, validUntil: time(o.current_period_end_date) }] : [];
        }
        case "subscription.canceled":
        case "subscription.scheduled_cancel": {
          const providerRef = str(o.id);
          return providerRef ? [{ type: "cancelled", providerRef, validUntil: time(o.current_period_end_date) }] : [];
        }
        case "subscription.expired":
        case "subscription.unpaid": {
          const providerRef = str(o.id);
          return providerRef ? [{ type: "ended", providerRef }] : [];
        }
        case "refund.created":
        case "dispute.created": {
          const providerRef = str(subscription?.id) ?? str(obj(o.order)?.id);
          return providerRef ? ([{ type: "refunded", providerRef }] satisfies LicenseEvent[]) : [];
        }
        default:
          return [];
      }
    },
  };
}
