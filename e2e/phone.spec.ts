import { expect, test, type Page } from "@playwright/test";

// A feed's page on a phone (issues #202 and #203): run by the phone projects, an iPhone on WebKit and a Pixel on Chromium.
const PNG = "e2e/fixtures/pixel.png";
const feedName = (suffix = "") => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${suffix}`;

async function post(page: Page, feed: string, markdown: string) {
  const res = await page.request.post(`/api/v1/feeds/${feed}/notes`, { headers: { "Content-Type": "text/markdown" }, data: markdown });
  expect(res.ok()).toBe(true);
}

// The page fits the screen: nothing to scroll sideways.
async function expectNoSideScroll(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
}

async function expectInsideViewport(page: Page, name: string, box: { x: number; y: number; width: number; height: number } | null) {
  const { width, height } = page.viewportSize()!;
  expect(box, name).not.toBeNull();
  expect(box!.x, `${name} left`).toBeGreaterThanOrEqual(0);
  expect(box!.y, `${name} top`).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, `${name} right`).toBeLessThanOrEqual(width);
  expect(box!.y + box!.height, `${name} bottom`).toBeLessThanOrEqual(height);
}

const bar = (page: Page) => page.getByLabel("Quick note in markdown");

test("an empty feed fits the screen", async ({ page }) => {
  await page.goto(`/${feedName()}`);
  await expect(bar(page)).toBeVisible();
  await expectNoSideScroll(page);
});

test("a feed with notes fits the screen", async ({ page }) => {
  const feed = feedName();
  await post(page, feed, "# A note\n\nWith a paragraph of ordinary words that wraps over a few lines on a phone.");
  await post(page, feed, "# Another\n\n- a list\n- of things");
  await page.goto(`/${feed}`);
  await expect(page.getByRole("link", { name: "A note" })).toBeVisible();
  await expectNoSideScroll(page);
});

test("a long feed name fits the screen", async ({ page }) => {
  // 64 characters, the longest a name can be, with no hyphen to break at.
  const feed = `e2e_${Date.now()}_${"x".repeat(64)}`.slice(0, 64);
  await post(page, feed, "# Hello");
  await page.goto(`/${feed}`);
  await expect(page.getByRole("link", { name: "Hello" })).toBeVisible();
  await expectNoSideScroll(page);
});

test("a long unbroken word in a note fits the screen", async ({ page }) => {
  const feed = feedName();
  const word = "Donaudampfschifffahrtsgesellschaft".repeat(4);
  await post(page, feed, `# Word\n\n${word} and https://example.com/${"a".repeat(120)}\n\n\`${word}\``);
  await post(page, feed, `# ${word}`);
  await page.goto(`/${feed}`);
  await expect(page.getByRole("link", { name: "Word", exact: true })).toBeVisible();
  await expectNoSideScroll(page);
});

test("the note bar, its + and its buttons lie inside the screen", async ({ page }) => {
  await page.goto(`/${feedName()}`);
  await expect(bar(page)).toBeVisible();
  await expectInsideViewport(page, "note bar", await bar(page).boundingBox());
  const plus = await page.getByRole("button", { name: "Title, tags and pictures" }).boundingBox();
  await expectInsideViewport(page, "+", plus);
  expect(plus!.x, "room left of +").toBeGreaterThanOrEqual(12);
  await expectInsideViewport(page, "camera", await page.getByRole("button", { name: "Take a photo" }).boundingBox());
  await page.getByLabel("Quick note in markdown").fill("Hello");
  const send = await page.getByRole("button", { name: "Send note" }).boundingBox();
  await expectInsideViewport(page, "send", send);
  expect(page.viewportSize()!.width - send!.x - send!.width, "room right of send").toBeGreaterThanOrEqual(12);
  await expectNoSideScroll(page);
});

// iOS Safari zooms into a smaller one when it gets the focus, and the zoomed page scrolls sideways.
test("the text fields are at least 16px, so focusing one does not zoom the page", async ({ page }) => {
  await page.goto(`/${feedName()}`);
  await expect(bar(page)).toBeVisible();
  const quick = await bar(page).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(quick).toBeGreaterThanOrEqual(16);
  await page.getByRole("button", { name: "Title, tags and pictures" }).click();
  const sizes = await page.locator("form[aria-label='New note']").evaluate((form) =>
    Array.from(form.querySelectorAll<HTMLElement>("input:not([type=file]):not([type=checkbox]), textarea")).map((el) => [el.id, parseFloat(getComputedStyle(el).fontSize)] as const),
  );
  for (const [id, size] of sizes) expect(size, id).toBeGreaterThanOrEqual(16);
});

test("the camera button stays next to Send, which waits for text or a photo", async ({ page }) => {
  await page.goto(`/${feedName()}`);
  const camera = page.getByRole("button", { name: "Take a photo" });
  const send = page.getByRole("button", { name: "Send note" });
  await expect(camera).toBeVisible();
  await expect(send).toBeDisabled();
  await page.getByLabel("Quick note in markdown").fill("Hello");
  await expect(send).toBeEnabled();
  await expect(camera).toBeVisible();
});

test("several photos can be added and are posted together", async ({ page }) => {
  const feed = feedName();
  await page.goto(`/${feed}`);
  const input = page.getByLabel("Photo from the camera");
  await expect(input).toHaveAttribute("multiple", "");
  await input.setInputFiles(PNG);
  await input.setInputFiles([PNG, PNG]);
  await expect(page.getByRole("list", { name: "Photos to send" }).locator("img")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Take a photo" })).toBeVisible();
  await page.getByRole("button", { name: "Send note" }).click();
  await expect(page).toHaveURL(new RegExp(`/${feed}\\?posted=`));
  await expect(page.locator("main ol img")).toHaveCount(3);
});

test("a photo from the camera button posts like one from the full box", async ({ page }) => {
  const feed = feedName();
  await page.goto(`/${feed}`);
  const camera = page.getByLabel("Photo from the camera");
  await expect(camera).toHaveAttribute("capture", "environment");
  await expect(camera).toHaveAttribute("accept", /image\//);
  await camera.setInputFiles(PNG);
  await expect(page.getByRole("list", { name: "Photos to send" }).locator("img")).toHaveCount(1);
  await page.getByRole("button", { name: "Send note" }).click();
  await expect(page).toHaveURL(new RegExp(`/${feed}\\?posted=`));
  await expect(page.locator("main ol img")).toHaveCount(1);
  await expectNoSideScroll(page);
});

test("a photo taken by mistake can be removed from the bar", async ({ page }) => {
  await page.goto(`/${feedName()}`);
  await page.getByLabel("Photo from the camera").setInputFiles(PNG);
  const photos = page.getByRole("list", { name: "Photos to send" });
  await expect(photos.locator("img")).toHaveCount(1);
  await photos.getByRole("button", { name: /^Remove / }).click();
  await expect(photos).toHaveCount(0);
  await expect(page.getByLabel("Quick note in markdown")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Take a photo" })).toBeVisible();
});
