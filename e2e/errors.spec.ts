import { expect, test } from "@playwright/test";

// A visitor never meets Next's plain pages: a missing note, a read link nobody has and an unknown address get notefeed's own page.
test("missing pages are notefeed's own page, with the way back", async ({ page }) => {
  for (const path of ["/e2e-no-such-feed/20260101T000000Z-0190", "/r/no-such-read-id/20260101T000000Z-0190", "/a/b/c/d"]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
    await expect(page.getByRole("heading", { name: "Nothing here" }), path).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to the start page" }), path).toBeVisible();
    await expect(page.getByText("This page could not be found"), path).toHaveCount(0);
  }
});
