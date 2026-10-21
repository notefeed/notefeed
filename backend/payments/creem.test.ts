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
  test("a checkout is created in the sandbox for a test key, with the key hash carried as metadata", async () => {
    const fetch = vi.fn(async () => Response.json({ id: "ch_1", checkout_url: "https://creem.io/pay/ch_1" }));
    const { url } = await creem(fetch as never).createCheckout({ keyHash: "h", successUrl: "https://n.test/license#k", period: "month" });
    expect(url).toBe("https://creem.io/pay/ch_1");
    const [to, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(to).toBe("https://test-api.creem.io/v1/checkouts");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("creem_test_abc");
    expect(JSON.parse(String(init.body))).toMatchObject({ product_id: "prod_1", success_url: "https://n.test/license#k", metadata: { key_hash: "h" } });
  });

  test("a failed checkout throws", async () => {
    await expect(creem((async () => new Response("no", { status: 401 })) as never).createCheckout({ keyHash: "h", successUrl: "u", period: "month" })).rejects.toThrow(/401/);
  });

  test("a yearly license is its own product, and none without one", async () => {
    const fetch = vi.fn(async () => Response.json({ checkout_url: "https://creem.io/pay/ch_2" }));
    await creem(fetch as never, "prod_year").createCheckout({ keyHash: "h", successUrl: "u", period: "year" });
    expect(JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toMatchObject({ product_id: "prod_year" });
    await expect(creem(fetch as never).createCheckout({ keyHash: "h", successUrl: "u", period: "year" })).rejects.toThrow(/no product/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("the portal link is the customer's, found through the subscription", async () => {
    const fetch = vi.fn(async (url: string) =>
      url.includes("/subscriptions") ? Response.json({ id: "sub_1", customer: { id: "cust_1", email: "a@b.test" } }) : Response.json({ customer_portal_link: "https://creem.io/portal/x" }),
    );
    expect(await creem(fetch as never).portalUrl("sub_1")).toEqual({ url: "https://creem.io/portal/x" });
    const [[read, readInit], [made, madeInit]] = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(read).toBe("https://test-api.creem.io/v1/subscriptions?subscription_id=sub_1");
    expect(readInit.method).toBe("GET");
    expect(made).toBe("https://test-api.creem.io/v1/customers/billing");
    expect(JSON.parse(String(madeInit.body))).toEqual({ customer_id: "cust_1" });
    // The customer can be its id alone.
    const plain = vi.fn(async (url: string) => (url.includes("/subscriptions") ? Response.json({ customer: "cust_2" }) : Response.json({ customer_portal_link: "https://creem.io/portal/y" })));
    expect(await creem(plain as never).portalUrl("sub_2")).toEqual({ url: "https://creem.io/portal/y" });
    await expect(creem((async () => new Response("no", { status: 404 })) as never).portalUrl("sub_3")).rejects.toThrow(/404/);
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
    expect(await parse(event("checkout.completed", { metadata: { key_hash: "h" }, subscription: { id: "sub_1", current_period_end_date: end } }))).toEqual([
      { type: "started", providerRef: "sub_1", keyHash: "h", validUntil: Date.parse(end) },
    ]);
    expect(await parse(event("subscription.paid", { id: "sub_1", current_period_end_date: end }))).toEqual([{ type: "renewed", providerRef: "sub_1", validUntil: Date.parse(end) }]);
    expect(await parse(event("subscription.canceled", { id: "sub_1", current_period_end_date: end }))).toEqual([{ type: "cancelled", providerRef: "sub_1", validUntil: Date.parse(end) }]);
    expect(await parse(event("subscription.expired", { id: "sub_1", current_period_end_date: end }))).toEqual([{ type: "ended", providerRef: "sub_1", periodEnd: Date.parse(end) }]);
    expect(await parse(event("subscription.expired", { id: "sub_1" }))).toEqual([{ type: "ended", providerRef: "sub_1", periodEnd: null }]);
    expect(await parse(event("refund.created", { subscription: { id: "sub_1" } }))).toEqual([{ type: "refunded", providerRef: "sub_1" }]);
    expect(await parse(event("credits.granted", {}))).toEqual([]);
  });

  // The two deliveries of a purchase in the sandbox (2026-10-13), cut to what matters and with the buyer taken out. `subscription.paid`
  // came first, before the license existed; the checkout carries the period's end itself.
  test("a real purchase: the checkout starts the license with its period, whichever of the two events comes first", async () => {
    const c = creem();
    const parse = (raw: string) => c.parseWebhook(raw, sign(raw));
    const subscription = {
      id: "sub_5SxQIJ0iU1PcTJxAEHhoPL",
      object: "subscription",
      collection_method: "charge_automatically",
      status: "active",
      current_period_start_date: "2026-10-13T20:41:45.091Z",
      current_period_end_date: "2026-11-13T20:41:45.091Z",
      canceled_at: null,
      metadata: { key_hash: "4cef140c" },
      mode: "test",
    };
    const end = Date.parse("2026-11-13T20:41:45.091Z");
    expect(await parse(event("subscription.paid", { ...subscription, product: { id: "prod_1" }, customer: { id: "cust_1" }, last_transaction_id: "tran_1", next_transaction_date: "2026-11-13T20:41:45.091Z" }))).toEqual([
      { type: "renewed", providerRef: "sub_5SxQIJ0iU1PcTJxAEHhoPL", validUntil: end },
    ]);
    const checkout = {
      id: "ch_4awpx6MPOwvjQNTIIVsZgh",
      object: "checkout",
      request_id: "4cef140c",
      order: { object: "order", id: "ord_Hn6GBlY3N1nn79dotAKvi", customer: "cust_1", product: "prod_1", amount: 150, currency: "EUR", status: "paid", type: "recurring" },
      product: { id: "prod_1" },
      customer: { id: "cust_1" },
      subscription: { ...subscription, product: "prod_1", customer: "cust_1" },
      status: "completed",
      metadata: { key_hash: "4cef140c" },
      mode: "test",
    };
    expect(await parse(event("checkout.completed", checkout))).toEqual([{ type: "started", providerRef: "sub_5SxQIJ0iU1PcTJxAEHhoPL", keyHash: "4cef140c", validUntil: end }]);
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

  // Creem's sample of the event (docs.creem.io, webhooks), cut the same way: not yet seen in the sandbox, where a period cannot be
  // run out early. Its status says `active` and its period starts where it ends; only the id is relied on.
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

  test("a completed checkout without a key hash is rejected", async () => {
    const raw = event("checkout.completed", { subscription: { id: "sub_1" } });
    await expect(creem().parseWebhook(raw, sign(raw))).rejects.toBeInstanceOf(WebhookRejectedError);
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
