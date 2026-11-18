// An instance that sells licenses (the fake provider, port 3104, a cap of 10 free notes, accounts open): a free feed's owner sees how
// many of the free notes it uses and a notice once it nears the cap (issue #183); a license is an account's (#391): bought for some
// feeds, it covers the ones its owner puts under it.
import { createHmac } from "node:crypto";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";

const text = { "Content-Type": "text/markdown" };
const feedName = () => `cap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

// A new account, signed in in this page's browser, and its id (from the API, with the page's session).
async function signedIn(page: Page): Promise<void> {
  await page.goto("/account/new");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.locator("code")).toHaveCount(2);
  await page.getByLabel("I saved them").check();
  await page.getByRole("link", { name: "Continue" }).click();
}

// Bought for the signed-in account: the checkout, then the webhook the provider would send. The fake provider's checkout id carries the
// account it was for (backend/payments/fake.ts).
async function buy(page: Page, units: number, ref: string): Promise<void> {
  const origin = { origin: new URL(page.url()).origin };
  const checkout = await page.request.post("/api/v1/account/license/checkout", { data: { units }, headers: origin });
  expect(checkout.status()).toBe(200);
  const id = new URL((await checkout.json()).url).searchParams.get("checkout_id")!;
  const account = Buffer.from(id.split("_")[1], "base64url").toString();
  await webhook(page.request, ref, account, units);
}

async function webhook(request: APIRequestContext, ref: string, account: string, units: number): Promise<void> {
  const events = JSON.stringify([{ type: "started", providerRef: ref, account, customerRef: "cust_e2e", period: "month", units, validUntil: null }]);
  const signature = createHmac("sha256", "e2e-webhook").update(events).digest("hex");
  expect(
    (await request.post("/api/licenses/webhook", { data: events, headers: { "Content-Type": "application/json", "x-fake-signature": signature } })).status(),
  ).toBe(200);
}

test("bought for one feed: a feed made while signed in goes under it; taken off and put back in its settings", async ({ page }) => {
  await signedIn(page);
  await buy(page, 1, `sub_${feedName()}`);
  const feed = feedName();
  const origin = { origin: new URL(page.url()).origin };
  expect((await page.request.post(`/api/v1/feeds/${feed}`, { data: { password: "e2e-password" }, headers: origin })).status()).toBe(201);
  expect((await page.request.post(`/api/v1/feeds/${feed}/notes`, { data: "# hi", headers: { ...origin, ...text } })).status()).toBe(201);
  await page.goto("/account");
  await expect(page.getByText("Your license covers 1 feed.")).toBeVisible();
  await expect(page.getByRole("link", { name: feed })).toBeVisible();
  await page.goto(`/${feed}/settings`);
  await page.getByText("Licensed", { exact: true }).click();
  await page.getByRole("button", { name: "Take it off your license" }).click();
  await expect(page.getByText("The feed is off your license.")).toBeVisible();
  await page.goto(`/${feed}/settings`);
  await page.getByText(/Free tier/).click();
  await page.getByRole("button", { name: "Put it under your license" }).click();
  await expect(page.getByText("The feed is under your license now.")).toBeVisible();
});

test("a new feed with a password needs an account with room; the box says why", async ({ page, request }) => {
  const feed = feedName();
  const res = await request.post(`/api/v1/feeds/${feed}`, { data: { password: "e2e-password" } });
  expect(res.status()).toBe(402);
  expect((await res.json()).code).toBe("license_required");
});

test("a free feed shows its notes against the cap and warns near it", async ({ page, request }) => {
  const feed = feedName();
  for (let i = 0; i < 8; i++) expect((await request.post(`/${feed}`, { data: `# Note ${i}`, headers: text })).status()).toBe(201);
  await page.goto(`/${feed}`);
  await expect(page.getByText(/free notes/)).toHaveCount(0);
  await page.goto(`/${feed}/settings`);
  await expect(page.getByText("Free tier · 8 of 10 notes")).toBeVisible();
  await request.post(`/${feed}`, { data: "# Note 8", headers: text });
  await page.goto(`/${feed}`);
  await expect(page.getByRole("status").filter({ hasText: "This feed holds 9 of its 10 free notes" })).toBeVisible();
  for (let i = 9; i < 12; i++) await request.post(`/${feed}`, { data: `# Note ${i}`, headers: text });
  await page.goto(`/${feed}`);
  const full = page.getByRole("status").filter({ hasText: "This feed is at its 10 free notes: each new note drops the oldest one." });
  await expect(full).toBeVisible();
  await expect(full.getByRole("link", { name: "A license" })).toHaveAttribute("href", "/license");
  expect((await (await request.get(`/api/v1/feeds/${feed}`)).json()).free_tier).toEqual({ notes: 10, cap: 10 });
});

test("the license page sells a month or a year for some feeds; signed out it sends you to sign in first", async ({ page }) => {
  await page.goto("/license");
  await expect(page.getByText("The newest 10 notes are kept")).toBeVisible(); // {cap}: NOTEFEED_FREE_NOTE_CAP
  const monthly = page.getByRole("region", { name: "Monthly" });
  const yearly = page.getByRole("region", { name: /^Yearly/ });
  await expect(monthly.getByText(/^1\.99\s€ per month$/)).toBeVisible();
  await expect(yearly.getByText(/^19\.90\s€ per year$/)).toBeVisible();
  await expect(page.getByText("A license belongs to an account: you sign in to one, or create one, before paying.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open your account" })).toHaveAttribute("href", "/account");
  await yearly.getByRole("button", { name: "Subscribe" }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Flicense/);
});

test("signed in, the yearly checkout for three feeds comes back to the account page", async ({ page }) => {
  await signedIn(page);
  await page.goto("/license");
  await page.getByLabel("Feeds it covers").fill("3");
  await page
    .getByRole("region", { name: /^Yearly/ })
    .getByRole("button", { name: "Subscribe" })
    .click();
  await expect(page).toHaveURL(/\/account\?bought=1/);
  await expect(page.getByText("Thank you. The license shows here once the payment provider confirms it")).toBeVisible();
});

test("the license tiles line up: prices and first features at the same height", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/license");
  const tiles = [page.getByRole("region", { name: "Free" }), page.getByRole("region", { name: "Monthly" }), page.getByRole("region", { name: /^Yearly/ })];
  const top = async (l: import("@playwright/test").Locator) => Math.round((await l.boundingBox())!.y);
  const prices = await Promise.all(tiles.map((t) => top(t.getByText(/^0\s€$|per (month|year)$/))));
  const features = await Promise.all(tiles.map((t) => top(t.getByRole("listitem").first())));
  expect(new Set(prices).size).toBe(1);
  expect(new Set(features).size).toBe(1);
});
