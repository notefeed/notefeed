// Creem (a merchant of record; https://docs.creem.io), ADR 0029. A key starting `creem_test_` talks to the sandbox. The webhook is
// signed with HMAC-SHA256 over the raw body, hex, in `creem-signature`; the same event can arrive more than once. A refund leaves
// the subscription running at Creem (seen in the sandbox), which is why licenseflow cancels it.
import { createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "../log";
import { processState } from "../state";
import { WebhookRejectedError, type LicenseEvent, type LicensePeriod, type PaymentProvider, type Plan } from "./types";

const log = logger("payments");

/** `productId` is the monthly license; `yearlyProductId` the yearly one, if sold. */
export type CreemOptions = { apiKey: string; productId: string; yearlyProductId?: string; webhookSecret: string; fetch?: typeof fetch };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const time = (v: unknown): number | null => {
  const t = typeof v === "string" || typeof v === "number" ? new Date(v).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
};

// The plans are the configured products as Creem holds them (ADR 0035), kept five minutes so a changed price shows soon without
// a read per page view. processState: the provider is made anew for each use, and Next may bundle this module once per route.
const PLANS_FRESH_MS = 5 * 60 * 1000;
const plansCache = processState("creem-plans", () => ({}) as { key?: string; at?: number; plans?: Plan[]; pending?: Promise<Plan[]> });

export function resetPlansForTests(): void {
  for (const k of Object.keys(plansCache)) delete plansCache[k as keyof typeof plansCache];
}

class ProductsUnreadable extends Error {}

export function createCreem({ apiKey, productId, yearlyProductId = "", webhookSecret, fetch: doFetch = fetch }: CreemOptions): PaymentProvider {
  const base = apiKey.startsWith("creem_test_") ? "https://test-api.creem.io/v1" : "https://api.creem.io/v1";
  const call = async (what: string, path: string, body?: unknown): Promise<Obj | undefined> => {
    const res = await doFetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "x-api-key": apiKey, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`creem: ${what} failed (${res.status})`);
    return obj(await res.json());
  };
  // One product: null when it is not offered (gone, not active, not a product), said in the log; throws when Creem cannot be read.
  const notOffered = (id: string, reason: string): null => {
    log.warn({ product: id, reason }, "a configured product is not offered");
    return null;
  };
  const product = async (period: LicensePeriod, id: string): Promise<Plan | null> => {
    let res: Response;
    try {
      res = await doFetch(`${base}/products?product_id=${encodeURIComponent(id)}`, { headers: { "x-api-key": apiKey }, signal: AbortSignal.timeout(5000) });
    } catch (e) {
      throw new ProductsUnreadable(e instanceof Error ? e.name : "error");
    }
    if (res.status === 404) return notOffered(id, "not found");
    if (!res.ok) throw new ProductsUnreadable(String(res.status));
    const p = obj(await res.json().catch(() => undefined));
    if (p?.status !== "active") return notOffered(id, "not active");
    const name = str(p.name);
    const amount = p.price;
    const currency = typeof p.currency === "string" && /^[A-Z]{3}$/.test(p.currency) ? p.currency : undefined;
    if (!name || !Number.isInteger(amount) || (amount as number) < 0 || !currency) return notOffered(id, "not a product");
    return { period, name, description: typeof p.description === "string" ? p.description : "", amount: amount as number, currency, taxIncluded: p.tax_mode === "inclusive" };
  };
  const refresh = async (): Promise<Plan[]> => {
    const sold: [LicensePeriod, string][] = [["month", productId], ...(yearlyProductId ? [["year", yearlyProductId] as [LicensePeriod, string]] : [])];
    return (await Promise.all(sold.map(([period, id]) => product(period, id)))).filter((p): p is Plan => p !== null);
  };
  return {
    async plans() {
      const key = `${base} ${productId} ${yearlyProductId}`;
      if (plansCache.key !== key) resetPlansForTests();
      if (plansCache.plans && Date.now() - (plansCache.at ?? 0) <= PLANS_FRESH_MS) return plansCache.plans;
      plansCache.key = key;
      plansCache.pending ??= refresh()
        .then((plans) => Object.assign(plansCache, { plans, at: Date.now() }).plans as Plan[])
        .catch((e) => {
          log.warn({ why: e instanceof ProductsUnreadable ? e.message : "error" }, "the products cannot be read");
          return plansCache.plans ?? []; // the last list while Creem is away, else none; nothing new is kept
        })
        .finally(() => (plansCache.pending = undefined));
      // A stale list is answered at once while the refresh runs: a slow or absent Creem holds up no page once it has answered once.
      return plansCache.plans ?? plansCache.pending;
    },

    async createCheckout({ keyHash, successUrl, period }) {
      const product = period === "year" ? yearlyProductId : productId;
      if (!product) throw new Error(`creem: no product for a license per ${period}`);
      const checkout = await call("creating a checkout", "/checkouts", { product_id: product, success_url: successUrl, request_id: keyHash, metadata: { key_hash: keyHash } });
      const url = str(checkout?.checkout_url);
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
          return providerRef ? [{ type: "ended", providerRef, periodEnd: time(o.current_period_end_date) }] : [];
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

    // The portal is the customer's, so the subscription is looked up first: its `customer` is the id, or the customer itself.
    async portalUrl(providerRef) {
      const subscription = await call("reading a subscription", `/subscriptions?subscription_id=${encodeURIComponent(providerRef)}`);
      const customer = str(subscription?.customer) ?? str(obj(subscription?.customer)?.id);
      if (!customer) throw new Error("creem: the subscription has no customer");
      const url = str((await call("creating a portal link", "/customers/billing", { customer_id: customer }))?.customer_portal_link);
      if (!url) throw new Error("creem: the portal has no customer_portal_link");
      return { url };
    },

    async cancel(providerRef) {
      if (!providerRef.startsWith("sub_")) return; // an order of a one-off product: nothing recurs
      await call("cancelling a subscription", `/subscriptions/${encodeURIComponent(providerRef)}/cancel`, { mode: "immediate" });
    },
  };
}
