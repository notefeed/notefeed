import { expect, test, type Page } from "@playwright/test";

const DATE_LABEL = "Date (optional; empty is now, a later time schedules the note)";
const feedName = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function postAndOpen(page: Page, name: string, markdown: string) {
  await page.goto(`/${name}`);
  await page.getByLabel("Note in markdown").fill(markdown);
  await page.getByRole("button", { name: "Post note" }).click();
  await page.getByRole("link", { name: markdown.replace(/^# /, "") }).click();
}

test("edit shows the new text on the note page and in the feed", async ({ page }) => {
  const name = feedName();
  await postAndOpen(page, name, "# First draft");
  await page.getByText("Edit", { exact: true }).click();
  await page.getByLabel("Note in markdown").fill("# Second draft");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await expect(page.getByRole("heading", { name: "Second draft" })).toBeVisible();
  await page.getByRole("navigation", { name: "Note actions" }).getByRole("link", { name: "All notes" }).click(); // from lg the way back is in the actions
  await expect(page.getByRole("link", { name: "Second draft" })).toBeVisible();
  await expect(page.getByText("First draft")).toHaveCount(0);
});

test("a refused save keeps the text and says why", async ({ page }) => {
  await postAndOpen(page, feedName(), "# Keep me");
  await page.getByText("Edit", { exact: true }).click();
  await page.getByLabel("Note in markdown").fill("   ");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("#note-actions-error")).toHaveText("The note is empty.");
  await expect(page.getByLabel("Note in markdown")).toHaveValue("   ");
});

test("delete lands on the feed without the note", async ({ page }) => {
  const name = feedName();
  await postAndOpen(page, name, "# Doomed");
  await page.getByText("Delete", { exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Delete this note?" })).toContainText("This can't be undone.");
  await page.getByRole("button", { name: "Delete note" }).click();
  await expect(page).toHaveURL(new RegExp(`/${name}\\?deleted=`));
  await expect(page.getByRole("status")).toHaveText("Note deleted.");
  await expect(page.getByText("Doomed")).toHaveCount(0);
});

// A dialog, not a card under the note: on a wide screen the card sat below a tall picture, out of sight.
test("delete asks in a dialog: Cancel has the focus, Escape and Cancel close it, nothing is deleted until confirmed", async ({ page }) => {
  const name = feedName();
  await postAndOpen(page, name, "# Careful");
  await page.getByText("Delete", { exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Delete this note?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.getByText("Delete", { exact: true }).click();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Careful" })).toBeVisible();
  await page.getByText("Delete", { exact: true }).click();
  await dialog.getByRole("button", { name: "Delete note" }).click();
  await expect(page).toHaveURL(new RegExp(`/${name}\\?deleted=`));
});

test("deleting the only note leaves a feed that cannot be given a password", async ({ page }) => {
  await postAndOpen(page, feedName(), "# Only one");
  await page.getByText("Delete", { exact: true }).click();
  await page.getByRole("button", { name: "Delete note" }).click();
  await expect(page.getByRole("status")).toHaveText("Note deleted.");
  await expect(page.getByLabel("Note in markdown")).toBeVisible();
  await expect(page.getByLabel("Password (optional, protects this feed)")).toHaveCount(0);
});

test("Ctrl+Enter saves an edit", async ({ page }) => {
  await postAndOpen(page, feedName(), "# Quick");
  await page.getByText("Edit", { exact: true }).click();
  await page.getByLabel("Note in markdown").fill("# Quick edited");
  await page.getByLabel("Note in markdown").press("Control+Enter");
  await expect(page.getByRole("heading", { name: "Quick edited" })).toBeVisible();
});

test("the read-only view has no edit or delete", async ({ page }) => {
  const name = feedName();
  await postAndOpen(page, name, "# Read me");
  await page.getByRole("navigation", { name: "Note actions" }).getByRole("link", { name: "All notes" }).click(); // from lg the way back is in the actions
  await page.getByRole("link", { name: "Open read-only view" }).click();
  await expect(page).toHaveURL(/\/r\/[^/]+$/); // the feed page has a "Read me" link too: wait until it is the read-only one
  await page.getByRole("link", { name: "Read me" }).click();
  await expect(page).toHaveURL(/\/r\/[^/]+\/[A-Za-z0-9_-]{22}$/);
  await expect(page.getByRole("heading", { name: "Read me" })).toBeVisible();
  await expect(page.getByText("Edit", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Delete", { exact: true })).toHaveCount(0);
});

test("tags typed in the compose box show as links that filter the feed", async ({ page }) => {
  const name = feedName();
  await page.goto(`/${name}`);
  await page.getByLabel("Note in markdown").fill("# Tagged");
  await page.getByLabel("Tags (optional, separated by commas)").fill("CI, deploy");
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("link", { name: "Tagged" })).toBeVisible();
  await page.getByRole("link", { name: "ci", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${name}\\?tag=ci$`));
  await expect(page.locator('[aria-current="page"]', { hasText: "ci" })).toBeVisible(); // the feed's tags show which one filters
  await expect(page.getByRole("link", { name: "Tagged" })).toBeVisible();
});

test("a note's tags change in the edit form; the feed filters by the new ones (#244)", async ({ page }) => {
  const name = feedName();
  await page.goto(`/${name}`);
  await page.getByLabel("Note in markdown").fill("# Retagged");
  await page.getByLabel("Tags (optional, separated by commas)").fill("draft");
  await page.getByRole("button", { name: "Post note" }).click();
  await page.getByRole("link", { name: "Retagged" }).click();
  const patched = page.waitForRequest((r) => r.method() === "PATCH");
  await page.getByText("Edit", { exact: true }).click();
  await expect(page.getByLabel("Tags (optional, separated by commas)")).toHaveValue("draft");
  await page.getByLabel("Tags (optional, separated by commas)").fill("Published, ci");
  await page.getByRole("button", { name: "Save" }).click();
  expect((await patched).postDataJSON()).toEqual({ tags: ["Published", "ci"] }); // the server folds the case
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await page.goto(`/${name}?tag=published`);
  await expect(page.getByRole("link", { name: "Retagged" })).toBeVisible();
  await page.goto(`/${name}?tag=draft`);
  await expect(page.getByRole("link", { name: "Retagged" })).toHaveCount(0);
});

test("a note dated in the past in the compose box goes below the newer ones, at its time", async ({ page }) => {
  const name = feedName();
  await page.goto(`/${name}`);
  await page.getByLabel("Note in markdown").fill("# Today");
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("link", { name: "Today" })).toBeVisible();
  const sent = page.waitForRequest((r) => r.method() === "POST");
  await page.getByLabel("Note in markdown").fill("# Long ago");
  await page.getByLabel(DATE_LABEL).fill("2025-03-01T09:30");
  await page.getByRole("button", { name: "Post note" }).click();
  expect((await sent).headers()["x-note-date"]).toMatch(/^2025-03-0[12]T\d\d:30:00\.000Z$/); // the browser's time zone, as UTC
  await expect(page.getByRole("link", { name: "Long ago" })).toBeVisible();
  const top = async (title: string) => (await page.getByRole("link", { name: title }).boundingBox())!.y;
  expect(await top("Today")).toBeLessThan(await top("Long ago")); // newest first: the older note goes below
});

test("the browser refuses a tag with a space in it", async ({ page }) => {
  await page.goto(`/${feedName()}`);
  await page.getByLabel("Note in markdown").fill("# Nope");
  await page.getByLabel("Tags (optional, separated by commas)").fill("two words");
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("link", { name: "Nope" })).toHaveCount(0);
});

test("saving an edit sends only what changed: nothing, the title, or the text", async ({ page }) => {
  const name = feedName();
  await postAndOpen(page, name, "# Edited");
  const writes: string[] = [];
  page.on("request", (r) => /\/notes\/[^/]+$/.test(r.url()) && ["PUT", "PATCH"].includes(r.method()) && writes.push(r.method()));
  await page.getByText("Edit", { exact: true }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("Note in markdown")).toBeHidden(); // the editor closed without a request
  expect(writes).toEqual([]);

  await page.getByText("Edit", { exact: true }).click();
  await page.getByLabel("Title (optional, otherwise taken from the text)").fill("Only the title");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  expect(writes).toEqual(["PATCH"]);

  await page.getByText("Edit", { exact: true }).click();
  await page.getByLabel("Note in markdown").fill("# Edited\nmore text");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("more text", { exact: true })).toBeVisible();
  expect(writes).toEqual(["PATCH", "PUT"]);
});

test("Preview renders the markdown as the note will show; pressing it again brings the text back unchanged", async ({ page }) => {
  const name = feedName();
  await page.goto(`/${name}`);
  await page.getByLabel("Note in markdown").fill("# Seen first\n\n- one\n- **two**\n\n<b>raw</b>");
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByRole("region", { name: "Preview" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Preview" }).getByRole("heading", { name: "Seen first" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Preview" }).locator("strong")).toHaveText("two");
  await expect(page.getByRole("region", { name: "Preview" })).toContainText("<b>raw</b>"); // raw HTML stays text
  await expect(page.getByLabel("Note in markdown")).toBeHidden();
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByLabel("Note in markdown")).toHaveValue("# Seen first\n\n- one\n- **two**\n\n<b>raw</b>");
  await page.getByRole("button", { name: "Post note" }).click();
  await page.getByRole("link", { name: "Seen first" }).click();
  // The editor has the same toggle, and an empty box says so.
  await page.getByText("Edit", { exact: true }).click();
  await page.getByLabel("Note in markdown").fill("");
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByRole("region", { name: "Preview" })).toHaveText("Nothing to preview.");
});

test("on a phone, the bar at the bottom takes the note: Send posts it, + opens the full box with the text in it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const name = feedName();
  await page.goto(`/${name}`);
  await page.getByLabel("Quick note in markdown").fill("# From the bar");
  await page.getByRole("button", { name: "Title, tags and pictures" }).click();
  await expect(page.getByLabel("Note in markdown")).toHaveValue("# From the bar");
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Send note" }).click();
  await expect(page.getByRole("link", { name: "From the bar" })).toBeVisible();
  await expect(page.getByLabel("Quick note in markdown")).toHaveValue("");
});

// A datetime-local value in the browser's time, `days` from now.
const localIn = (page: Page, days: number) =>
  page.evaluate((d) => {
    const t = new Date(Date.now() + d * 86_400_000);
    t.setMinutes(t.getMinutes() - t.getTimezoneOffset());
    return t.toISOString().slice(0, 16);
  }, days);

test("a note dated tomorrow shows as scheduled on the feed page and not on the read page", async ({ page }) => {
  const name = feedName();
  await page.goto(`/${name}`);
  const first = page.waitForResponse((r) => r.request().method() === "POST" && r.ok());
  await page.getByLabel("Note in markdown").fill("# Out now");
  await page.getByRole("button", { name: "Post note" }).click();
  const readUrl: string = (await (await first).json()).read_url;
  await expect(page.getByRole("link", { name: "Out now" })).toBeVisible();
  await page.getByLabel("Note in markdown").fill("# Coming tomorrow");
  await page.getByLabel(DATE_LABEL).fill(await localIn(page, 1));
  await page.getByRole("button", { name: "Post note" }).click();
  const card = page.getByRole("listitem").filter({ hasText: "Coming tomorrow" });
  await expect(card).toContainText("Scheduled for");
  await expect(page.getByRole("listitem").filter({ hasText: "Out now" })).not.toContainText("Scheduled");
  await card.getByRole("link", { name: /Coming tomorrow/ }).first().click();
  await expect(page.getByRole("article")).toContainText("Scheduled for");

  await page.goto(new URL(readUrl).pathname.replace(/\/[^/]*$/, ""));
  await expect(page.getByText("Out now")).toBeVisible();
  await expect(page.getByText("Coming tomorrow")).toHaveCount(0);
  await expect(page.getByText("Scheduled for")).toHaveCount(0);
});

test("changing a note's date in the edit form moves it in the list", async ({ page }) => {
  const name = feedName();
  await page.goto(`/${name}`);
  await page.getByLabel("Note in markdown").fill("# Older");
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("link", { name: "Older" })).toBeVisible();
  await page.getByLabel("Note in markdown").fill("# Newer");
  await page.getByRole("button", { name: "Post note" }).click();
  const top = async (title: string) => (await page.getByRole("link", { name: title }).boundingBox())!.y;
  await expect(page.getByRole("link", { name: "Newer" })).toBeVisible();
  expect(await top("Newer")).toBeLessThan(await top("Older"));

  await page.getByRole("link", { name: "Newer" }).click();
  const sent: string[] = [];
  page.on("request", (r) => r.method() === "PATCH" && sent.push(r.postData() ?? ""));
  await page.getByText("Edit", { exact: true }).click();
  const date = page.getByLabel("Date (in your time; a later one schedules the note)");
  await expect(date).toHaveValue(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/); // the note's date, prefilled
  await date.fill("2025-03-01T09:30");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  expect(JSON.parse(sent[0]).date).toMatch(/^2025-03-0[12]T\d\d:30:00\.000Z$/); // the browser's time, as UTC
  await expect(page.getByRole("article").locator("time")).toContainText("2025");
  await page.getByRole("navigation", { name: "Note actions" }).getByRole("link", { name: "All notes" }).click();
  await expect(page.getByRole("link", { name: "Newer" })).toBeVisible();
  expect(await top("Older")).toBeLessThan(await top("Newer"));
});
