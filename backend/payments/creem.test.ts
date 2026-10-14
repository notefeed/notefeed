import { createHmac } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import { createCreem } from "./creem";
import { WebhookRejectedError } from "./types";

const SECRET = "whsec";
const sign = (raw: string) => new Headers({ "creem-signature": createHmac("sha256", SECRET).update(raw).digest("hex") });
const creem = (fetch?: typeof globalThis.fetch) => createCreem({ apiKey: "creem_test_abc", productId: "prod_1", webhookSecret: SECRET, fetch });
const event = (eventType: string, object: unknown) => JSON.stringify({ id: "evt_1", eventType, created_at: 1, object });

describe("Creem", () => {
  test("a checkout is created in the sandbox for a test key, with the key hash carried as metadata", async () => {
    const fetch = vi.fn(async () => Response.json({ id: "ch_1", checkout_url: "https://creem.io/pay/ch_1" }));
    const { url } = await creem(fetch as never).createCheckout({ keyHash: "h", successUrl: "https://n.test/license#k" });
    expect(url).toBe("https://creem.io/pay/ch_1");
    const [to, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(to).toBe("https://test-api.creem.io/v1/checkouts");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("creem_test_abc");
    expect(JSON.parse(String(init.body))).toMatchObject({ product_id: "prod_1", success_url: "https://n.test/license#k", metadata: { key_hash: "h" } });
  });

  test("a failed checkout throws", async () => {
    await expect(creem((async () => new Response("no", { status: 401 })) as never).createCheckout({ keyHash: "h", successUrl: "u" })).rejects.toThrow(/401/);
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
    expect(await parse(event("subscription.expired", { id: "sub_1" }))).toEqual([{ type: "ended", providerRef: "sub_1" }]);
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

  test("a completed checkout without a key hash is rejected", async () => {
    const raw = event("checkout.completed", { subscription: { id: "sub_1" } });
    await expect(creem().parseWebhook(raw, sign(raw))).rejects.toBeInstanceOf(WebhookRejectedError);
  });
});
