import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createCreem, resetPlansForTests } from "./creem";
import FIXTURE from "./fixtures/creem-product.json";
import { WebhookRejectedError } from "./types";

const SECRET = "whsec";
const sign = (raw: string) => new Headers({ "creem-signature": createHmac("sha256", SECRET).update(raw).digest("hex") });
const creem = (fetch?: typeof globalThis.fetch, yearlyProductId?: string) => createCreem({ apiKey: "creem_test_abc", productId: "prod_1", yearlyProductId, webhookSecret: SECRET, fetch });
const event = (eventType: string, object: unknown) => JSON.stringify({ id: "evt_1", eventType, created_at: 1, object });

describe("Creem", () => {
  test("a checkout is created in the sandbox for a test key, coming back to the success page", async () => {
    const fetch = vi.fn(async () => Response.json({ id: "ch_1", checkout_url: "https://creem.io/pay/ch_1" }));
    const { url } = await creem(fetch as never).createCheckout({ successUrl: "https://n.test/license", period: "month" });
    expect(url).toBe("https://creem.io/pay/ch_1");
    const [to, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(to).toBe("https://test-api.creem.io/v1/checkouts");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("creem_test_abc");
    expect(JSON.parse(String(init.body))).toEqual({ product_id: "prod_1", success_url: "https://n.test/license" });
  });

  test("the key of a checkout is Creem's, once the checkout is completed", async () => {
    const checkouts: Record<string, unknown> = {
      ch_done: { id: "ch_done", status: "completed", license_keys: [{ id: "lk_1", key: "ABCDE-FGHIJ-KLMNO-PQRST-UVWXY", status: "inactive" }] },
      ch_open: { id: "ch_open", status: "pending" },
      ch_nokey: { id: "ch_nokey", status: "completed" },
    };
    const fetch = vi.fn(async (url: string) => {
      const c = checkouts[new URL(url).searchParams.get("checkout_id") ?? ""];
      return c ? Response.json(c) : new Response("{}", { status: 404 });
    });
    const c = creem(fetch as never);
    expect(await c.checkoutKey("ch_done")).toBe("ABCDE-FGHIJ-KLMNO-PQRST-UVWXY");
    expect(String(fetch.mock.calls[0][0])).toBe("https://test-api.creem.io/v1/checkouts?checkout_id=ch_done");
    expect(await c.checkoutKey("ch_open")).toBeNull();
    expect(await c.checkoutKey("ch_nokey")).toBeNull();
    expect(await c.checkoutKey("ch_gone")).toBeNull();
    await expect(creem((async () => new Response("no", { status: 500 })) as never).checkoutKey("ch_done")).rejects.toThrow(/500/);
  });

  test("a failed checkout throws", async () => {
    await expect(creem((async () => new Response("no", { status: 401 })) as never).createCheckout({ successUrl: "u", period: "month" })).rejects.toThrow(/401/);
  });

  test("a yearly license is its own product, and none without one", async () => {
    const fetch = vi.fn(async () => Response.json({ checkout_url: "https://creem.io/pay/ch_2" }));
    await creem(fetch as never, "prod_year").createCheckout({ successUrl: "u", period: "year" });
    expect(JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toMatchObject({ product_id: "prod_year" });
    await expect(creem(fetch as never).createCheckout({ successUrl: "u", period: "year" })).rejects.toThrow(/no product/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("buyers manage their purchases at Creem's own login, never through a key (#316)", () => {
    const provider = creem(vi.fn() as never);
    expect(provider.accountUrl).toBe("https://creem.io/my-orders/login");
    expect("portalUrl" in provider).toBe(false);
  });

  test("cancelling ends a subscription at once, and leaves an order alone", async () => {
    const fetch = vi.fn(async () => Response.json({ id: "sub_1", status: "canceled" }));
    await creem(fetch as never).cancel("sub_1");
    const [to, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(to).toBe("https://test-api.creem.io/v1/subscriptions/sub_1/cancel");
    expect(JSON.parse(String(init.body))).toEqual({ mode: "immediate" });
    await creem(fetch as never).cancel("ord_1");
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(creem((async () => new Response("no", { status: 400 })) as never).cancel("sub_1")).rejects.toThrow(/400/);
  });

  test("a wrong signature is rejected", async () => {
    await expect(creem().parseWebhook(event("subscription.paid", { id: "sub_1" }), new Headers({ "creem-signature": "00" }))).rejects.toBeInstanceOf(WebhookRejectedError);
  });

  test("the events map to license events", async () => {
    const c = creem();
    const parse = (raw: string) => c.parseWebhook(raw, sign(raw));
    const end = "2026-11-13T00:00:00.000Z";
    expect(await parse(event("checkout.completed", { license_keys: [{ key: "K1" }, { key: "K2" }], subscription: { id: "sub_1", current_period_end_date: end } }))).toEqual([
      { type: "started", providerRef: "sub_1", key: "K1", validUntil: Date.parse(end) },
    ]);
    expect(await parse(event("subscription.paid", { id: "sub_1", current_period_end_date: end }))).toEqual([{ type: "renewed", providerRef: "sub_1", validUntil: Date.parse(end) }]);
    expect(await parse(event("subscription.canceled", { id: "sub_1", current_period_end_date: end }))).toEqual([{ type: "cancelled", providerRef: "sub_1", validUntil: Date.parse(end) }]);
    expect(await parse(event("subscription.expired", { id: "sub_1", current_period_end_date: end }))).toEqual([{ type: "ended", providerRef: "sub_1", periodEnd: Date.parse(end) }]);
    expect(await parse(event("subscription.expired", { id: "sub_1" }))).toEqual([{ type: "ended", providerRef: "sub_1", periodEnd: null }]);
    expect(await parse(event("refund.created", { subscription: { id: "sub_1" } }))).toEqual([{ type: "refunded", providerRef: "sub_1" }]);
    expect(await parse(event("credits.granted", {}))).toEqual([]);
  });

  // A purchase in the sandbox (2026-10-21), cut to what matters and with the buyer taken out: `subscription.paid` as delivered on
  // 2026-10-13, when it came first, before the license existed; the checkout as GET /v1/checkouts answered it, the same object as in
  // `checkout.completed`, with the key Creem issued and the period's end.
  test("a real purchase: the checkout starts the license with Creem's key and its period, whichever of the two events comes first", async () => {
    const c = creem();
    const parse = (raw: string) => c.parseWebhook(raw, sign(raw));
    const subscription = {
      id: "sub_5ByrAINlOMEdV41p5rgCVD",
      object: "subscription",
      collection_method: "charge_automatically",
      status: "active",
      current_period_start_date: "2026-10-21T13:22:09.460Z",
      current_period_end_date: "2026-10-22T13:22:09.460Z",
      canceled_at: null,
      mode: "test",
    };
    const end = Date.parse("2026-10-22T13:22:09.460Z");
    expect(await parse(event("subscription.paid", { ...subscription, product: { id: "prod_1" }, customer: { id: "cust_1" }, last_transaction_id: "tran_1", next_transaction_date: "2026-10-22T13:22:09.460Z" }))).toEqual([
      { type: "renewed", providerRef: "sub_5ByrAINlOMEdV41p5rgCVD", validUntil: end },
    ]);
    const checkout = {
      id: "ch_3Hf2CMdqu6ju7QKwWldus4",
      object: "checkout",
      order: { object: "order", id: "ord_bBj4yQ9V5oZFneB4tqldk", customer: "cust_1", product: "prod_1", amount: 100, currency: "EUR", status: "paid", type: "recurring" },
      product: { id: "prod_1", billing_type: "recurring", billing_period: "every-day", tax_mode: "inclusive" },
      units: 1,
      success_url: "https://notefeed.me/license",
      customer: { id: "cust_1", object: "customer" },
      subscription: { ...subscription, product: "prod_1", customer: "cust_1", last_transaction_id: "tran_1", next_transaction_date: "2026-10-22T13:22:09.460Z" },
      license_keys: [
        {
          object: "license",
          id: "lk_7XbHvAY2vkZzY9tLEdQDXn",
          product_id: "prod_1",
          status: "inactive",
          key: "QG8JS-KFP31-7SAHT-QS770-7CD4O",
          activation: 0,
          activation_limit: 1,
          expires_at: null,
          created_at: "2026-10-21T13:22:11.824Z",
          instance: null,
          mode: "test",
        },
      ],
      feature: [{ type: "licenseKey" }],
      status: "completed",
      mode: "test",
    };
    expect(await parse(event("checkout.completed", checkout))).toEqual([{ type: "started", providerRef: "sub_5ByrAINlOMEdV41p5rgCVD", key: "QG8JS-KFP31-7SAHT-QS770-7CD4O", validUntil: end }]);
    const fetch = vi.fn(async () => Response.json(checkout));
    expect(await creem(fetch as never).checkoutKey("ch_3Hf2CMdqu6ju7QKwWldus4")).toBe("QG8JS-KFP31-7SAHT-QS770-7CD4O");
  });

  // The deliveries after a purchase in the sandbox (2026-10-14), cut the same way: a cancel in the customer portal (`canceled` at once,
  // the period still paid), a cancel at the period's end, and a refund, whose subscription is still `active` at Creem.
  test("real cancels and a real refund", async () => {
    const c = creem();
    const parse = (raw: string) => c.parseWebhook(raw, sign(raw));
    const subscription = (status: string, end: string, canceledAt: string | null) => ({
      id: "sub_6I28jztOO823nH6JIoMh1S",
      object: "subscription",
      collection_method: "charge_automatically",
      status,
      last_transaction: { id: "tran_1", object: "transaction", amount: 150, status: "paid", subscription: "sub_6I28jztOO823nH6JIoMh1S", period_end: Date.parse(end) },
      current_period_start_date: "2026-10-14T07:44:09.127Z",
      current_period_end_date: end,
      canceled_at: canceledAt,
      metadata: { key_hash: "b75ed477" },
      mode: "test",
    });
    const end = "2026-11-14T07:44:09.127Z";
    expect(await parse(event("subscription.canceled", subscription("canceled", end, "2026-10-14T07:46:47.886Z")))).toEqual([
      { type: "cancelled", providerRef: "sub_6I28jztOO823nH6JIoMh1S", validUntil: Date.parse(end) },
    ]);
    expect(await parse(event("subscription.scheduled_cancel", { ...subscription("scheduled_cancel", end, null), next_transaction_date: end }))).toEqual([
      { type: "cancelled", providerRef: "sub_6I28jztOO823nH6JIoMh1S", validUntil: Date.parse(end) },
    ]);
    const refund = {
      id: "ref_3SwiGjVEwHQkm65VLFzMUa",
      object: "refund",
      status: "succeeded",
      refund_amount: 150,
      refund_currency: "EUR",
      reason: "requested_by_customer",
      transaction: { id: "tran_1", object: "transaction", amount: 150, status: "paid", order: "ord_1", subscription: "sub_6I28jztOO823nH6JIoMh1S" },
      subscription: { ...subscription("active", end, null), product: "prod_1", customer: "cust_1" },
      checkout: { id: "ch_1", object: "checkout", request_id: "b75ed477" },
      mode: "test",
    };
    expect(await parse(event("refund.created", refund))).toEqual([{ type: "refunded", providerRef: "sub_6I28jztOO823nH6JIoMh1S" }]);
  });

  // A daily product in the sandbox (2026-10-19 to 21), cut the same way. A renewal is `subscription.update` then `subscription.paid`
  // with the next period. A cancel at the period's end is carried out ahead of it (20:00 UTC, 11.5 hours early) as a plain
  // `subscription.canceled`, its period end kept, and nothing follows at that end. A paused subscription sends nothing more.
  test("a real renewal, a cancel at the period's end carried out early, and a pause", async () => {
    const c = creem();
    const parse = (raw: string) => c.parseWebhook(raw, sign(raw));
    const subscription = (id: string, status: string, start: string, end: string) => ({
      id,
      object: "subscription",
      items: [{ object: "subscription_item", id: "sitem_1", product_id: "prod_1", price_id: "pprice_1", units: 1 }],
      collection_method: "charge_automatically",
      status,
      current_period_start_date: start,
      current_period_end_date: end,
      canceled_at: null as string | null,
      metadata: { key_hash: "543a6bb2" },
      mode: "test",
    });
    const renewed = subscription("sub_5YSfn3UClqcsPBDHxZOBA3", "active", "2026-10-20T05:29:23.115Z", "2026-10-21T05:29:23.115Z");
    expect(await parse(event("subscription.update", renewed))).toEqual([]);
    expect(await parse(event("subscription.paid", { ...renewed, last_transaction_id: "tran_1", next_transaction_date: "2026-10-21T05:29:23.115Z" }))).toEqual([
      { type: "renewed", providerRef: "sub_5YSfn3UClqcsPBDHxZOBA3", validUntil: Date.parse("2026-10-21T05:29:23.115Z") },
    ]);
    const end = "2026-10-21T07:38:27.717Z";
    const carriedOut = { ...subscription("sub_MlPlfUVr4OJzJ9ACnubau", "canceled", "2026-10-20T07:38:27.717Z", end), canceled_at: "2026-10-20T20:00:01.967Z" };
    expect(await parse(event("subscription.canceled", carriedOut))).toEqual([{ type: "cancelled", providerRef: "sub_MlPlfUVr4OJzJ9ACnubau", validUntil: Date.parse(end) }]);
    const paused = subscription("sub_6Rp1HuGfUGOjY7X880h7Kv", "paused", "2026-10-19T05:37:38.000Z", "2026-10-20T05:37:38.000Z");
    expect(await parse(event("subscription.paused", paused))).toEqual([]);
  });

  // Creem's sample of the event (docs.creem.io, webhooks), cut the same way. Creem sends it when a period ends without a payment, which
  // the sandbox cannot make happen (its portal refuses every failing test card); a cancel never leads to it. Its status says `active`
  // and its period starts where it ends; only the id is relied on.
  test("the documented expiry ends the license", async () => {
    const c = creem();
    const raw = event("subscription.expired", {
      id: "sub_7FgHvrOMC28tG5DEemoCli",
      object: "subscription",
      product: { id: "prod_3ELsC3Lt97orn81SOdgQI3", billing_type: "recurring", billing_period: "every-year" },
      customer: { id: "cust_3y4k2CELGsw7n9Eeeiw2hm", object: "customer" },
      collection_method: "charge_automatically",
      status: "active",
      last_transaction_id: "tran_6ZeTvMqMkGdAIIjw5aAcnh",
      last_transaction_date: "2024-12-16T12:40:12.658Z",
      next_transaction_date: "2025-12-16T12:39:47.000Z",
      current_period_start_date: "2024-12-16T12:39:47.000Z",
      current_period_end_date: "2024-12-16T12:39:47.000Z",
      canceled_at: null,
      mode: "local",
    });
    expect(await c.parseWebhook(raw, sign(raw))).toEqual([{ type: "ended", providerRef: "sub_7FgHvrOMC28tG5DEemoCli", periodEnd: Date.parse("2024-12-16T12:39:47.000Z") }]);
  });

  test("a completed checkout without a license key is rejected: the product does not issue keys", async () => {
    for (const keys of [undefined, [], [{ id: "lk_1" }]]) {
      const raw = event("checkout.completed", { subscription: { id: "sub_1" }, metadata: { key_hash: "h" }, license_keys: keys });
      await expect(creem().parseWebhook(raw, sign(raw))).rejects.toBeInstanceOf(WebhookRejectedError);
    }
  });
});

// The product as GET /v1/products answered it in the test store on 2026-10-19 (fixtures/creem-product.json, cut down).
describe("Creem's plans", () => {
  beforeEach(resetPlansForTests);
  afterEach(() => vi.useRealTimers());
  const product = (over: Record<string, unknown> = {}) => Response.json({ ...FIXTURE, ...over });
  const both = (yearly: () => Response | Promise<Response> = () => product({ id: "prod_year", name: "Yearly", price: 1990, description: null })) =>
    vi.fn(async (url: string) => (url.endsWith("prod_year") ? yearly() : product()));
  const monthly = { period: "month", name: "notefeed license, monthly", description: FIXTURE.description, amount: 199, currency: "EUR", taxIncluded: true };

  test("the plans are the configured products, monthly then yearly, as Creem holds them", async () => {
    const fetch = both();
    expect(await creem(fetch as never, "prod_year").plans()).toEqual([monthly, { period: "year", name: "Yearly", description: "", amount: 1990, currency: "EUR", taxIncluded: true }]);
    const [to, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(to).toBe("https://test-api.creem.io/v1/products?product_id=prod_1");
    expect(init.headers).toMatchObject({ "x-api-key": "creem_test_abc" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  test("without a yearly product there is the monthly plan alone; tax not included is said so", async () => {
    expect(await creem((async () => product({ tax_mode: "exclusive" })) as never).plans()).toEqual([{ ...monthly, taxIncluded: false }]);
  });

  test("a product that is gone, not active or not a product is left out", async () => {
    expect(await creem(both(() => new Response("{}", { status: 404 })) as never, "prod_year").plans()).toEqual([monthly]);
    resetPlansForTests();
    expect(await creem((async () => product({ status: "archived" })) as never).plans()).toEqual([]);
    resetPlansForTests();
    expect(await creem((async () => product({ price: "1.99" })) as never).plans()).toEqual([]);
    resetPlansForTests();
    expect(await creem((async () => product({ currency: "euro" })) as never).plans()).toEqual([]);
  });

  test("the plans are kept five minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const fetch = both();
    await creem(fetch as never, "prod_year").plans();
    await creem(fetch as never, "prod_year").plans();
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    await creem(fetch as never, "prod_year").plans();
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  test("other products are other plans: a changed setting is not served from the cache", async () => {
    const fetch = both();
    await creem(fetch as never).plans();
    expect(await creem(fetch as never, "prod_year").plans()).toHaveLength(2);
  });

  test("a failed refresh serves the stale list, and with none an empty one that is not kept", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await creem((async () => product()) as never).plans();
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    const down = vi.fn(async () => new Response("no", { status: 500 }));
    expect(await creem(down as never).plans()).toEqual([monthly]);
    resetPlansForTests();
    expect(await creem(down as never).plans()).toEqual([]);
    const up = vi.fn(async () => product());
    expect(await creem(up as never).plans()).toEqual([monthly]);
  });

  test("a stale list is served at once while the refresh runs, not after it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await creem((async () => product()) as never).plans();
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    let answer: (r: Response) => void = () => {};
    const slow = vi.fn(() => new Promise<Response>((resolve) => (answer = resolve)));
    expect(await creem(slow as never).plans()).toEqual([monthly]); // would hang if it waited for Creem
    answer(product({ price: 299 }));
    await vi.waitFor(async () => expect((await creem(slow as never).plans())[0].amount).toBe(299));
    expect(slow).toHaveBeenCalledTimes(1);
  });

  test("a read that times out counts as unreachable", async () => {
    const fetch = vi.fn(async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    expect(await creem(fetch as never).plans()).toEqual([]);
  });

  test("concurrent calls share one refresh", async () => {
    const fetch = both();
    const lists = await Promise.all([1, 2, 3].map(() => creem(fetch as never, "prod_year").plans()));
    expect(lists.every((l) => l.length === 2)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("a description is kept as written, line breaks too", async () => {
    expect((await creem((async () => product({ description: "a\nb" })) as never).plans())[0].description).toBe("a\nb");
  });
});
