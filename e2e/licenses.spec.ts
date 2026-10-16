// An instance that sells licenses (the fake provider, port 3104, a cap of 10 free notes): a free feed's owner sees how many of
// the free notes it uses, a notice on the feed once it nears the cap, and neither once a license is on it (issue #183); a new
// feed gets its password and its license key in one post (issue #193).
import { createHash, createHmac } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";

const text = { "Content-Type": "text/markdown" };
const feedName = () => `cap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

// Bought: the checkout's key, activated by the fake provider's webhook.
async function buy(request: APIRequestContext, ref: string): Promise<string> {
  const { url } = await (await request.post("/api/licenses/checkout")).json();
  const key = String(url).split("#")[1];
  const events = JSON.stringify([{ type: "started", providerRef: ref, keyHash: createHash("sha256").update(key).digest("hex"), validUntil: null }]);
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

// The license page offers both periods when a yearly price is set; the fake provider's checkout is the success page itself.
test("the license page sells a month or a year, and the yearly checkout comes back with a key", async ({ page }) => {
  await page.goto("/license");
  await expect(page.getByText("EUR 1.99 per month")).toBeVisible();
  await expect(page.getByText(/or EUR 19.90 per year/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Pay monthly" })).toBeVisible();
  await page.getByRole("button", { name: "Pay yearly" }).click();
  await expect(page.getByRole("heading", { name: "Your license key" })).toBeVisible();
  expect(new URL(page.url()).hash).toMatch(/^#[A-Za-z0-9_-]{22}$/);
});

// A feed password needs a license, and a feed can only get a password when it is created: the box of a new feed takes the key
// next to the password. Without it, the refusal is a banner that says what to do (issue #193).
test("a new feed gets its password and its license key in one post; without the key, the box says why", async ({ page, request }) => {
  const feed = feedName();
  const key = await buy(request, `sub_${feed}`);
  await page.goto(`/${feed}`);
  await page.getByLabel("Note in markdown").fill("# Secret note");
  await page.getByLabel("Password (optional, protects this feed)").fill("Passw0rd!x");
  await page.getByRole("button", { name: "Post note" }).click();
  const banner = page.getByRole("alert").filter({ hasText: "A feed password needs a license." });
  await expect(banner).toBeVisible();
  await expect(banner.getByRole("link", { name: "Buy a license" })).toHaveAttribute("href", "/license");
  expect((await request.get(`/api/v1/feeds/${feed}`)).status()).toBe(404); // nothing was created

  await page.getByLabel("License key (needed with a password)").fill(key);
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("link", { name: "Secret note" })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: /license/ })).toHaveCount(0);
  await page.goto(`/${feed}/settings`);
  await expect(page.getByText("Licensed", { exact: true })).toBeVisible();
  // Protected: a stranger is asked for the password.
  expect((await request.post(`/${feed}`, { data: "# Stranger", headers: text })).status()).toBe(401);
});
