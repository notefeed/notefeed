// Creem (a merchant of record; https://docs.creem.io), ADR 0029, through Creem's own packages (#339): the `creem` SDK for the API,
// `@creem_io/webhook-types` for the signature and the deliveries. What stays here is what a delivery means for a license. A key
// starting `creem_test_` talks to the sandbox. The products carry Creem's license key feature: Creem makes the key, puts it in the
// receipt e-mail and the customer portal, and hands it over in the completed checkout. The same delivery can arrive more than
// once. A refund leaves the subscription running at Creem (seen in the sandbox), which is why licenseflow cancels it.
//
// Not `@creem_io/nextjs`: its webhook handler writes every completed checkout, the buyer's e-mail address and license key included,
// to the console (V2), and compares the signature in variable time.
import { timingSafeEqual } from "node:crypto";
import { generateSignature, parseWebhookEvent, type CheckoutEntity, type WebhookEvent } from "@creem_io/webhook-types";
import { Creem } from "creem";
import { HTTPClient } from "creem/lib/http.js";
import { CreemError, ResponseValidationError } from "creem/models/errors";
import { logger } from "../log";
import { processState } from "../state";
import { WebhookRejectedError, type LicenseEvent, type LicensePeriod, type PaymentProvider, type Plan } from "./types";

const log = logger("payments");

/** `productId` is the monthly license; `yearlyProductId` the yearly one, if sold. `fetch` is for the tests. */
export type CreemOptions = { apiKey: string; productId: string; yearlyProductId?: string; webhookSecret: string; fetch?: typeof fetch };

const time = (v: unknown): number | null => {
  const t = typeof v === "string" || typeof v === "number" || v instanceof Date ? new Date(v).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
};
// A delivery nests an entity either whole or as its id.
const idOf = (v: { id: string } | string | undefined): string | undefined => (typeof v === "string" ? v : v?.id) || undefined;

// The plans are the configured products as Creem holds them (ADR 0035), kept five minutes so a changed price shows soon without
// a read per page view. processState: the provider is made anew for each use, and Next may bundle this module once per route.
const PLANS_FRESH_MS = 5 * 60 * 1000;
const plansCache = processState("creem-plans", () => ({}) as { key?: string; at?: number; plans?: Plan[]; pending?: Promise<Plan[]> });

export function resetPlansForTests(): void {
  for (const k of Object.keys(plansCache)) delete plansCache[k as keyof typeof plansCache];
}

// Why Creem could not be read, for the log: never the answer itself.
const why = (e: unknown): string => (e instanceof ResponseValidationError ? "an answer the SDK does not accept" : e instanceof CreemError ? String(e.statusCode) : e instanceof Error ? e.name : "error");

// The key of a checkout: the first of `license_keys`, one per unit bought; notefeed sells one. Creem sends it, in the API and in the
// delivery, but the delivery's types leave it out.
const licenseKey = (keys: { key?: unknown }[] | undefined): string | undefined => {
  const key = keys?.[0]?.key;
  return typeof key === "string" && key !== "" ? key : undefined;
};

export function createCreem({ apiKey, productId, yearlyProductId = "", webhookSecret, fetch }: CreemOptions): PaymentProvider {
  const test = apiKey.startsWith("creem_test_");
  const creem = new Creem({ apiKey, server: test ? "test" : "prod", ...(fetch ? { httpClient: new HTTPClient({ fetcher: fetch }) } : {}) });

  // One product: null when it is not offered (gone or not active), said in the log; throws when Creem cannot be read.
  const notOffered = (id: string, reason: string): null => {
    log.warn({ product: id, reason }, "a configured product is not offered");
    return null;
  };
  const product = async (period: LicensePeriod, id: string): Promise<Plan | null> => {
    try {
      const p = await creem.products.get(id, { timeoutMs: 5000 });
      if (p.status !== "active") return notOffered(id, "not active");
      return { period, name: p.name, description: p.description ?? "", amount: p.price, currency: p.currency, taxIncluded: p.taxMode === "inclusive" };
    } catch (e) {
      if (e instanceof CreemError && e.statusCode === 404) return notOffered(id, "not found");
      throw e;
    }
  };
  const refresh = async (): Promise<Plan[]> => {
    const sold: [LicensePeriod, string][] = [["month", productId], ...(yearlyProductId ? [["year", yearlyProductId] as [LicensePeriod, string]] : [])];
    return (await Promise.all(sold.map(([period, id]) => product(period, id)))).filter((p): p is Plan => p !== null);
  };

  return {
    // Creem's own sign-in for customers: the e-mail address bought with, then a link by mail (#316).
    accountUrl: "https://creem.io/my-orders/login",

    async plans() {
      const key = `${test} ${productId} ${yearlyProductId}`;
      if (plansCache.key !== key) resetPlansForTests();
      if (plansCache.plans && Date.now() - (plansCache.at ?? 0) <= PLANS_FRESH_MS) return plansCache.plans;
      plansCache.key = key;
      plansCache.pending ??= refresh()
        .then((plans) => Object.assign(plansCache, { plans, at: Date.now() }).plans as Plan[])
        .catch((e) => {
          log.warn({ why: why(e) }, "the products cannot be read");
          return plansCache.plans ?? []; // the last list while Creem is away, else none; nothing new is kept
        })
        .finally(() => (plansCache.pending = undefined));
      // A stale list is answered at once while the refresh runs: a slow or absent Creem holds up no page once it has answered once.
      return plansCache.plans ?? plansCache.pending;
    },

    async createCheckout({ successUrl, period }) {
      const product = period === "year" ? yearlyProductId : productId;
      if (!product) throw new Error(`creem: no product for a license per ${period}`);
      const checkout = await creem.checkouts.create({ productId: product, successUrl });
      if (!checkout.checkoutUrl) throw new Error("creem: the checkout has no checkout_url");
      return { url: checkout.checkoutUrl };
    },

    async checkoutKey(checkoutId) {
      let checkout: { status?: unknown; licenseKeys?: { key?: unknown }[] };
      try {
        checkout = await creem.checkouts.retrieve(checkoutId);
      } catch (e) {
        if (e instanceof CreemError && e.statusCode === 404) return null;
        // The SDK (1.13.0) wants `feature` as one object; Creem answers a list, as the delivery's types say, so it refuses every
        // real checkout. Its answer is read as it came then: two fields, checked here.
        if (!(e instanceof ResponseValidationError)) throw new Error(`creem: reading a checkout failed (${why(e)})`);
        const raw = (e.rawValue ?? {}) as { status?: unknown; license_keys?: { key?: unknown }[] };
        checkout = { status: raw.status, licenseKeys: Array.isArray(raw.license_keys) ? raw.license_keys : undefined };
      }
      return (checkout.status === "completed" && licenseKey(checkout.licenseKeys)) || null;
    },

    async parseWebhook(rawBody, headers) {
      const a = Buffer.from(headers.get("creem-signature") ?? "");
      const b = Buffer.from(await generateSignature(rawBody, webhookSecret));
      if (a.length !== b.length || !timingSafeEqual(a, b)) throw new WebhookRejectedError("bad signature");
      let event: WebhookEvent;
      try {
        event = parseWebhookEvent(rawBody) as WebhookEvent;
      } catch {
        throw new WebhookRejectedError("not a Creem event");
      }
      switch (event.eventType) {
        case "checkout.completed": {
          const o = event.object as CheckoutEntity & { license_keys?: { key?: unknown }[] };
          // A one-off product has no subscription: the order is the reference then.
          const providerRef = idOf(o.subscription) ?? idOf(o.order);
          const key = licenseKey(o.license_keys);
          if (!providerRef || !key) throw new WebhookRejectedError("a completed checkout without a subscription and a license key");
          const subscription = typeof o.subscription === "object" ? o.subscription : undefined;
          return [{ type: "started", providerRef, key, validUntil: time(subscription?.current_period_end_date) }];
        }
        case "subscription.active":
        case "subscription.paid":
          return event.object.id ? [{ type: "renewed", providerRef: event.object.id, validUntil: time(event.object.current_period_end_date) }] : [];
        // `canceled` comes at once when the buyer cancels in the portal, with the paid period still running: it stays to its end.
        case "subscription.canceled":
        case "subscription.scheduled_cancel":
          return event.object.id ? [{ type: "cancelled", providerRef: event.object.id, validUntil: time(event.object.current_period_end_date) }] : [];
        case "subscription.expired":
        case "subscription.paused":
        case "subscription.unpaid":
          return event.object.id ? [{ type: "ended", providerRef: event.object.id, periodEnd: time(event.object.current_period_end_date) }] : [];
        case "refund.created":
        case "dispute.created": {
          const providerRef = idOf(event.object.subscription) ?? idOf(event.object.order);
          return providerRef ? ([{ type: "refunded", providerRef }] satisfies LicenseEvent[]) : [];
        }
        default:
          return [];
      }
    },

    async cancel(providerRef) {
      if (!providerRef.startsWith("sub_")) return; // an order of a one-off product: nothing recurs
      await creem.subscriptions.cancel(providerRef, { mode: "immediate" });
    },
  };
}
