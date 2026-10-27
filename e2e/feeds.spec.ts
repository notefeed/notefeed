import { expect, test, type Browser, type Page } from "@playwright/test";

const feedName = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function post(page: Page, name: string, markdown = "# A note", password?: string) {
  await page.goto(`/${name}`);
  if (password) await page.getByLabel("Password (optional, protects this feed)").fill(password);
  await page.getByLabel("Note in markdown").fill(markdown);
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("link", { name: markdown.replace(/^# /, "") })).toBeVisible();
}

async function setDetails(page: Page, title: string, description: string) {
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.getByLabel("Description").fill(description);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
}

test("title and description show on the feed page, the read-only view and in the RSS", async ({ page, request }) => {
  const name = feedName();
  await post(page, name);
  await setDetails(page, "My ideas", "Things I think about");
  await expect(page).toHaveURL(/\/settings\?saved=1$/);
  await page.getByRole("link", { name: "Back to the feed" }).click();
  await expect(page.getByRole("heading", { name: "My ideas" })).toBeVisible();
  await expect(page.getByText("Things I think about")).toBeVisible();
  await expect(page.getByRole("banner").getByText(name)).toBeVisible(); // the name stays visible
  await expect(page).toHaveTitle(/My ideas/);

  await page.getByRole("link", { name: "Open read-only view" }).click();
  await expect(page).toHaveURL(/\/r\/[^/]+$/); // the feed page has the same heading: wait for the read-only one
  await expect(page.getByRole("heading", { name: "My ideas" })).toBeVisible();
  await expect(page.getByText("Things I think about")).toBeVisible();
  await expect(page.getByText(name)).toHaveCount(0);
  const rss = await request.get((await page.getByRole("link", { name: "RSS" }).getAttribute("href"))!);
  const xml = await rss.text();
  expect(xml).toContain("My ideas");
  expect(xml).toContain("Things I think about");
});

test("a refused title says why, on the settings page", async ({ page }) => {
  const name = feedName();
  await post(page, name);
  const refusal = "The title, description or read id is too long or too short, or has characters that aren't allowed.";
  // With JavaScript: the API refuses a tab, and the form shows it.
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByLabel("Title", { exact: true }).fill("a\tb");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert").filter({ hasText: refusal })).toBeVisible();
  // Without: where the plain forms' redirects land.
  await page.goto(`/${name}/settings?form=details&error=invalid_body`);
  await expect(page.getByRole("alert").filter({ hasText: refusal })).toBeVisible();
  await expect(page.locator("#compose-error")).toHaveCount(0); // the compose box lives on the feed page
  await page.goto(`/${name}/settings?form=details&error=invalid_request`);
  await expect(page.getByRole("alert").filter({ hasText: "Type the feed's name" })).toHaveText("Type the feed's name to confirm.");
});

test("delete by typing the name lands on the home page; the feed and its read link are empty", async ({ page }) => {
  const name = feedName();
  await post(page, name);
  const readHref = await page.getByRole("link", { name: "Open read-only view" }).getAttribute("href");
  await page.getByRole("link", { name: "Settings" }).click();
  await page.locator("summary", { hasText: "Delete this feed" }).click();
  const button = page.getByRole("button", { name: "Delete feed" });
  await expect(button).toBeDisabled();
  await page.getByLabel("Feed name").fill(name.slice(0, -1));
  await expect(button).toBeDisabled();
  await page.getByLabel("Feed name").fill(name);
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page).toHaveURL(/\/\?deleted=/);
  await expect(page.getByRole("status")).toHaveText("Feed deleted.");
  await page.goto(`/${name}`);
  await expect(page.getByText("No notes yet.")).toBeVisible();
  await page.goto(readHref!);
  await expect(page.getByText("No notes yet.")).toBeVisible();
});

test("a locked feed's page does not contain its title", async ({ page, browser, baseURL }) => {
  const name = feedName();
  await post(page, name, "# Secret note", "hunter2");
  await setDetails(page, "Hidden title", "Hidden description");
  const other = await (await browser.newContext({ baseURL })).newPage();
  await other.goto(`/${name}`);
  await expect(other.getByRole("button", { name: "Unlock" })).toBeVisible();
  const html = await other.content();
  expect(html).not.toContain("Hidden title");
  expect(html).not.toContain("Hidden description");
});

test("deleting a protected feed works for the unlocked browser", async ({ page }) => {
  const name = feedName();
  await post(page, name, "# Secret note", "hunter2");
  await page.getByRole("link", { name: "Settings" }).click();
  await page.locator("summary", { hasText: "Delete this feed" }).click();
  await page.getByLabel("Feed name").fill(name);
  await page.getByRole("button", { name: "Delete feed" }).click();
  await expect(page.getByRole("status")).toHaveText("Feed deleted.");
  await page.goto(`/${name}`);
  await expect(page.getByLabel("Note in markdown")).toBeVisible(); // a new, open feed again
});

test("a refused save says why", async ({ page }) => {
  const name = feedName();
  await post(page, name);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.route("**/api/v1/feeds/*", (route) => route.fulfill({ status: 429, headers: { "retry-after": "7" }, json: { error: "slow down", code: "rate_limited" } }));
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "seconds" })).toContainText("Too many requests, try again in 7 seconds.");
});

test("without JavaScript, the settings and delete forms still work", async ({ browser, baseURL }: { browser: Browser; baseURL?: string }) => {
  const page = await (await browser.newContext({ baseURL, javaScriptEnabled: false })).newPage();
  const name = feedName();
  // Posting needs the web UI's JavaScript; the settings forms do not.
  expect((await page.request.post(`/${name}`, { data: "# Plain note", headers: { "content-type": "text/markdown" } })).status()).toBe(201);
  await page.goto(`/${name}`);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Plain title");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/\/settings\?saved=1$/);
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await page.getByRole("link", { name: "Back to the feed" }).click();
  await expect(page.getByRole("heading", { name: "Plain title" })).toBeVisible();
  await page.getByRole("link", { name: "Settings" }).click();

  await page.locator("summary", { hasText: "Delete this feed" }).click(); // a <details>: opens without JavaScript
  await page.getByLabel("Feed name").fill(name);
  await page.getByRole("button", { name: "Delete feed" }).click();
  await expect(page).toHaveURL(/\/\?deleted=/);
  await expect(page.getByRole("status")).toHaveText("Feed deleted.");
});

test("the read id can be chosen on the settings page, and generated again", async ({ page, request }) => {
  const name = feedName();
  await post(page, name);
  const id = `rid-${Math.random().toString(36).slice(2, 10)}`;
  await page.getByRole("link", { name: "Settings" }).click();
  await page.locator("summary", { hasText: "Read id" }).click();
  await page.getByLabel("Read id").fill(id);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await expect(page.getByText(`/r/${id}/feed.xml`)).toBeVisible();
  expect((await request.get(`/r/${id}/feed.xml`)).status()).toBe(200);
  await expect(page.getByLabel("Read id")).toHaveValue(id);
  await page.locator("summary", { hasText: "Read id" }).click(); // saving shows the page closed again
  await page.getByRole("button", { name: "Generate a random one" }).click();
  await expect(page.getByLabel("Read id")).not.toHaveValue(id);
  await expect(page.getByLabel("Read id")).toHaveValue(/^[A-Za-z0-9_-]{22}$/);
});

// The running version (#306): in the info menu and the site footer, linked to where it came from (`dev` in a local build).
test("the info menu and the footer show the running version", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(`/${feedName()}`);
  await page.getByText("About & legal").click();
  await expect(page.getByRole("link", { name: "notefeed dev" })).toHaveAttribute("href", "https://github.com/notefeed/notefeed");
  await page.goto("/");
  await expect(page.getByRole("contentinfo").getByRole("link", { name: "notefeed dev" })).toBeVisible();
});

// A note on the read page (#307): on a wide screen the right column holds a large way back to the feed.
test("a note's read page has All notes in the right column on a wide screen", async ({ page, request }) => {
  const name = feedName();
  const posted = await (await request.post(`/api/v1/feeds/${name}/notes`, { data: "# Side note", headers: { "Content-Type": "text/markdown" } })).json();
  const feedPage = new URL(posted.read_url).pathname.replace(/\/feed\.xml$/, "");
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`${feedPage}/${posted.id}`);
  const back = page.getByRole("navigation", { name: "Feed" }).getByRole("link", { name: /All notes/ });
  await expect(back).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to all notes" })).toBeHidden(); // the small link above the note is for narrower screens
  await back.click();
  await expect(page).toHaveURL(feedPage);
});

// Pictures don't grow with the window (#308): a large one stays within 40rem and 80% of the screen's height.
test("a large picture is capped in width and height", async ({ page, request }) => {
  const name = feedName();
  await page.setViewportSize({ width: 1800, height: 900 });
  await page.goto("/");
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 3000;
    c.height = 2000;
    const g = c.getContext("2d")!;
    g.fillStyle = "#c08040";
    g.fillRect(0, 0, 3000, 2000);
    return c.toDataURL("image/png").split(",")[1];
  });
  const posted = await (await request.post(`/api/v1/feeds/${name}/notes`, { data: Buffer.from(png, "base64"), headers: { "Content-Type": "image/png" } })).json();
  await request.post(`/api/v1/feeds/${name}/notes`, { data: `# With a picture\n\n![](${posted.file})`, headers: { "Content-Type": "text/markdown" } });
  await page.goto(`/${name}`);
  const inline = page.locator(".md img").first();
  await expect(inline).toBeVisible();
  const box = (await inline.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(640 + 1);
  expect(box.height).toBeLessThanOrEqual(900 * 0.8 + 1);
});
