// An instance that sells licenses (the fake provider, port 3104, a cap of 10 free notes): a free feed's owner sees how many of
// the free notes it uses, a notice on the feed once it nears the cap, and neither once a license is on it (issue #183); a new
// feed gets its password and its license key in one post (issue #193).
import { createHmac } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";

const text = { "Content-Type": "text/markdown" };
const feedName = () => `cap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

// Bought: the key the fake provider issued for the checkout, activated by its webhook.
async function buy(request: APIRequestContext, ref: string): Promise<string> {
  const { url } = await (await request.post("/api/licenses/checkout")).json();
  const checkout = new URL(url, "http://e2e.invalid").searchParams.get("checkout_id"); // relative without PUBLIC_URL
  const { key } = await (await request.post("/api/licenses/key", { data: { checkout } })).json();
  const events = JSON.stringify([{ type: "started", providerRef: ref, key, validUntil: null }]);
  const signature = createHmac("sha256", "e2e-webhook").update(events).digest("hex");
  expect((await request.post("/api/licenses/webhook", { data: events, headers: { "Content-Type": "application/json", "x-fake-signature": signature } })).status()).toBe(200);
  return key;
}

test("a free feed shows its notes against the cap, warns near it, and a license lifts it", async ({ page, request }) => {
  const feed = feedName();
  for (let i = 0; i < 8; i++) expect((await request.post(`/${feed}`, { data: `# Note ${i}`, headers: text })).status()).toBe(201);

  // Below 90 %: the settings show the usage, the feed's page says nothing.
  await page.goto(`/${feed}`);
  await expect(page.getByText(/free notes/)).toHaveCount(0);
  await page.goto(`/${feed}/settings`);
  await expect(page.getByText("Free tier · 8 of 10 notes")).toBeVisible();
  await page.getByText("Free tier · 8 of 10 notes").click();
  await expect(page.getByRole("meter", { name: "Free notes used" })).toHaveAttribute("aria-valuenow", "8");
  expect((await (await request.get(`/api/v1/feeds/${feed}`)).json()).free_tier).toEqual({ notes: 8, cap: 10 });

  await request.post(`/${feed}`, { data: "# Note 8", headers: text });
  await page.goto(`/${feed}`);
  await expect(page.getByRole("status").filter({ hasText: "This feed holds 9 of its 10 free notes" })).toBeVisible();

  // At the cap, each new note drops the oldest: the feed still holds 10.
  for (let i = 9; i < 12; i++) await request.post(`/${feed}`, { data: `# Note ${i}`, headers: text });
  await page.goto(`/${feed}`);
  const full = page.getByRole("status").filter({ hasText: "This feed is at its 10 free notes: each new note drops the oldest one." });
  await expect(full).toBeVisible();
  await expect(full.getByRole("link", { name: "A license" })).toHaveAttribute("href", "/license");
  expect((await (await request.get(`/api/v1/feeds/${feed}`)).json()).free_tier).toEqual({ notes: 10, cap: 10 });

  // Bought (the fake provider's webhook) and entered on the feed: no cap, no notice.
  const key = await buy(request, `sub_${feed}`);
  await page.goto(`/${feed}/settings`);
  await page.getByText(/Free tier/).click();
  await page.getByPlaceholder("License key").fill(key);
  await page.getByRole("button", { name: "Use key" }).click();
  await expect(page.getByText("The license is on this feed now.")).toBeVisible();
  await expect(page.getByText("Licensed", { exact: true })).toBeVisible();
  await page.goto(`/${feed}`);
  await expect(page.getByText(/free notes/)).toHaveCount(0);
  expect((await (await request.get(`/api/v1/feeds/${feed}`)).json()).free_tier).toBeNull();
});

// The license page offers the fake provider's two plans, a tile each, in the words of fixtures/license.md; the fake
// provider's checkout is the success page itself, which shows the key it issued.
test("the license page sells a month or a year, and the yearly checkout comes back with a key", async ({ page }) => {
  await page.goto("/license");
  await expect(page.getByText("A license lifts the free tier's limits for one feed.")).toBeVisible();
  await expect(page.getByText("The newest 10 notes are kept")).toBeVisible(); // {cap}: NOTEFEED_FREE_NOTE_CAP
  const monthly = page.getByRole("region", { name: "Monthly" });
  const yearly = page.getByRole("region", { name: /^Yearly/ });
  await expect(monthly.getByText("€1.99 per month")).toBeVisible();
  await expect(yearly.getByText("€19.90 per year")).toBeVisible();
  await expect(yearly.getByText("Save 16 %")).toBeVisible(); // against 12 × €1.99
  await expect(page.getByText("A subscription renews until you cancel it.")).toBeVisible(); // the fine print, Markdown
  await expect(page.getByRole("link", { name: "terms" })).toHaveAttribute("href", "/terms");
  await expect(monthly.getByRole("button", { name: "Subscribe" })).toBeVisible();
  await yearly.getByRole("button", { name: "Subscribe" }).click();
  await expect(page.getByRole("heading", { name: "Your license key" })).toBeVisible();
  await expect(page.locator("code")).toHaveText(/^[A-Za-z0-9_-]{22}$/);
  await expect(page.getByText("The key is also in the payment provider's receipt e-mail")).toBeVisible();
});

// A feed password needs a license, and a feed can only get a password when it is created: a new feed's "Protect this feed" section
// in its details, not the compose box, takes the key next to the password (issue #205). Without it, the refusal is a banner that
// says what to do (issue #193).
test("a new feed gets its password and its license key in one post; without the key, the box says why", async ({ page, request }) => {
  const feed = feedName();
  const key = await buy(request, `sub_${feed}`);
  await page.goto(`/${feed}`);
  const protect = page.getByRole("region", { name: "Protect this feed" });
  await expect(page.getByRole("form", { name: "New note" }).getByLabel(/Password|License key/)).toHaveCount(0);
  await page.getByLabel("Note in markdown").fill("# Secret note");
  await protect.getByLabel("Password (optional, protects this feed)").fill("Passw0rd!x");
  await page.getByRole("button", { name: "Post note" }).click();
  const banner = page.getByRole("alert").filter({ hasText: "A feed password needs a license." });
  await expect(banner).toBeVisible();
  await expect(banner.getByRole("link", { name: "Buy a license" })).toHaveAttribute("href", "/license");
  await expect(banner).toContainText("enter its key under Protect this feed");
  expect((await request.get(`/api/v1/feeds/${feed}`)).status()).toBe(404); // nothing was created

  await protect.getByLabel("License key (needed with a password)").fill(key);
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("link", { name: "Secret note" })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: /license/ })).toHaveCount(0);
  await expect(protect).toHaveCount(0); // the feed exists now
  await page.goto(`/${feed}/settings`);
  await expect(page.getByText("Licensed", { exact: true })).toBeVisible();
  // Protected: a stranger is asked for the password.
  expect((await request.post(`/${feed}`, { data: "# Stranger", headers: text })).status()).toBe(401);
});

// Seen on notefeed.me (2026-10-21): on a protected feed whose license was refunded, the settings page could not enter a new
// key. Its request went to /api/licenses/attach, where the feed's unlock cookie is never sent, and the lapsed license still
// held the feed. The page now posts under the feed's path, and a new key replaces a lapsed one.
test("on a protected feed, a new key from the settings page replaces a refunded license", async ({ page, request }) => {
  const feed = feedName();
  const ref = `sub_${feed}`;
  const first = await buy(request, ref);
  await page.goto(`/${feed}`);
  await page.getByLabel("Note in markdown").fill("# Secret note");
  const protect = page.getByRole("region", { name: "Protect this feed" });
  await protect.getByLabel("Password (optional, protects this feed)").fill("Passw0rd!x");
  await protect.getByLabel("License key (needed with a password)").fill(first);
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("link", { name: "Secret note" })).toBeVisible();

  const refund = JSON.stringify([{ type: "refunded", providerRef: ref }]);
  const signature = createHmac("sha256", "e2e-webhook").update(refund).digest("hex");
  expect((await request.post("/api/licenses/webhook", { data: refund, headers: { "Content-Type": "application/json", "x-fake-signature": signature } })).status()).toBe(200);

  const second = await buy(request, `${ref}_2`);
  await page.goto(`/${feed}/settings`);
  await page.getByText(/^Free tier/).click();
  await page.getByLabel("License key").fill(second);
  await page.getByRole("button", { name: "Use key" }).click();
  await expect(page.getByText("The license is on this feed now.")).toBeVisible();
  await expect(page.getByText("Licensed", { exact: true })).toBeVisible();
});
