// Drafts (#265, V3): a draft and its picture reach no reader by any route, on the file system and on SQLite; publishing shows
// them everywhere at their own date, making the note a draft again hides them again.
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { PNG } from "../backend/testimages";

// The Draft mark on a note's card (the compose box's own "Draft" checkbox is a label, not this).
const draftMark = (page: Page) => page.locator("span", { hasText: /^Draft$/ });

const feedName = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Everything a reader can ask for, by the read id: whether each route has the note (and its picture).
async function readerSees(request: APIRequestContext, readId: string, id: string, file: string) {
  const ok = async (path: string) => (await request.get(path)).status() === 200;
  return {
    page: (await (await request.get(`/r/${readId}`)).text()).includes("Unfinished thought"),
    rss: (await (await request.get(`/r/${readId}/feed.xml`)).text()).includes("Unfinished thought"),
    list: ((await (await request.get(`/api/v1/read/${readId}/notes`)).json()).notes as { id: string }[]).some((n) => n.id === id),
    note: await ok(`/api/v1/read/${readId}/notes/${id}`),
    notePage: await ok(`/r/${readId}/${id}`),
    file: await ok(`/r/${readId}/${file}`),
    byName: await ok(`/r/${readId}/draft-pic.png`),
  };
}
const none = { page: false, rss: false, list: false, note: false, notePage: false, file: false, byName: false };
const all = { page: true, rss: true, list: true, note: true, notePage: true, file: true, byName: true };

test("a draft and its picture reach no reader; publishing shows them, making it a draft again hides them", async ({ page, request }) => {
  const name = feedName();
  const posted = await request.post(`/api/v1/feeds/${name}/notes`, {
    headers: { "X-Note-Draft": "true", "X-Note-Date": "2025-03-01T08:00:00Z" },
    multipart: { text: "# Unfinished thought\n\n![](draft-pic.png)", file: { name: "draft-pic.png", mimeType: "image/png", buffer: Buffer.from(PNG) } },
  });
  expect(posted.status()).toBe(201);
  const made = await posted.json();
  expect(made.draft).toBe(true);
  const readId = /\/r\/([^/]+)\//.exec(made.read_url)![1];
  const file = made.attachments[0].file as string;

  expect(await readerSees(request, readId, made.id, file)).toEqual(none);
  await page.goto(`/${name}`);
  await expect(page.getByRole("link", { name: "Unfinished thought" })).toBeVisible();
  await expect(draftMark(page).first()).toBeVisible();

  const published = await request.patch(`/api/v1/feeds/${name}/notes/${made.id}`, { data: { draft: false } });
  expect((await published.json()).date).toBe("2025-03-01T08:00:00.000Z");
  expect(await readerSees(request, readId, made.id, file)).toEqual(all);

  await request.patch(`/api/v1/feeds/${name}/notes/${made.id}`, { data: { draft: true } });
  expect(await readerSees(request, readId, made.id, file)).toEqual(none);
});

test("posting a draft from the compose box, and publishing it from the edit form", async ({ page }) => {
  const name = feedName();
  await page.goto(`/${name}`);
  await page.getByLabel("Note in markdown").fill("# Composed draft");
  await page.getByRole("checkbox", { name: "Draft" }).check();
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("link", { name: "Composed draft" })).toBeVisible();
  await expect(draftMark(page)).toHaveCount(1);
  await page.getByRole("link", { name: "Composed draft" }).click();
  await page.getByText("Edit", { exact: true }).click();
  await page.getByRole("checkbox", { name: /^Draft/ }).uncheck();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await expect(draftMark(page)).toHaveCount(0);
});
