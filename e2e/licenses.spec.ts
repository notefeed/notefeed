// An instance that sells licenses (the fake provider, port 3104, a cap of 10 free notes): a free feed's owner sees how many of
// the free notes it uses, a notice on the feed once it nears the cap, and neither once a license is on it (issue #183).
import { createHash, createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";

const text = { "Content-Type": "text/markdown" };
const feedName = () => `cap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

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
  const { url } = await (await request.post("/api/licenses/checkout")).json();
  const key = String(url).split("#")[1];
  const events = JSON.stringify([{ type: "started", providerRef: `sub_${feed}`, keyHash: createHash("sha256").update(key).digest("hex"), validUntil: null }]);
  const signature = createHmac("sha256", "e2e-webhook").update(events).digest("hex");
  expect((await request.post("/api/licenses/webhook", { data: events, headers: { "Content-Type": "application/json", "x-fake-signature": signature } })).status()).toBe(200);
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
