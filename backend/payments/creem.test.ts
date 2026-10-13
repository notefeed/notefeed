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

  test("a completed checkout without a key hash is rejected", async () => {
    const raw = event("checkout.completed", { subscription: { id: "sub_1" } });
    await expect(creem().parseWebhook(raw, sign(raw))).rejects.toBeInstanceOf(WebhookRejectedError);
  });
});
