// The operator's endpoint in the built app, against the S3 stand-in of the "s3" project (e2e/s3-setup.ts): the listing goes through
// the app's own fetch here, which the unit tests cannot show.
import { expect, test } from "@playwright/test";
import { png as pngOf } from "../backend/testimages";

const URL = "/api/operator/images/unreferenced";
const auth = { Authorization: `Bearer ${"e2e-operator-token-".padEnd(32, "x")}` };

test("without the token: 401, also for a browser that is on the site", async ({ request }) => {
  expect((await request.get(URL)).status()).toBe(401);
  expect((await request.delete(URL, { headers: { Authorization: "Bearer wrong" } })).status()).toBe(401);
});

test("the report and the clean-up answer for the S3 store, and leave an object written a moment ago alone", async ({ request }) => {
  // An object no note names, put into the stand-in directly (it only looks for a signed-looking header).
  const key = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  const direct = `http://127.0.0.1:3199/e2e-images/${key}`;
  const signedLooking = { Authorization: "AWS4-HMAC-SHA256 Credential=e2e-access/x, SignedHeaders=host, Signature=x" };
  expect((await request.put(direct, { headers: signedLooking, data: "left behind" })).status()).toBe(200);

  const report = await request.get(URL, { headers: auth });
  expect(report.status()).toBe(200);
  const seen = await report.json();
  expect(seen).toMatchObject({ store: "s3", unreferenced: { count: 0, bytes: 0 }, missing: 0 });
  expect(seen.too_recent).toBeGreaterThanOrEqual(1);
  expect(seen.deleted).toBeUndefined();

  const cleaned = await request.delete(URL, { headers: auth });
  expect(cleaned.status()).toBe(200);
  expect(await cleaned.json()).toMatchObject({ store: "s3", deleted: { count: 0, bytes: 0 }, failed: 0 });
  expect((await request.get(direct, { headers: signedLooking })).status()).toBe(200); // still there
});

test("takedown (#155): the feed answers removed under both identifiers, the picture is gone from the store and refused again", async ({ request, page }) => {
  const feed = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const png = Buffer.from(pngOf(Date.now() % 0x1000000)); // a picture of its own each run: the blocklist outlives the run
  const text = await request.post(`/api/v1/feeds/${feed}/notes`, { headers: { "Content-Type": "text/markdown" }, data: "# Reported" });
  expect(text.status()).toBe(201);
  const picture = await request.post(`/api/v1/feeds/${feed}/notes`, { headers: { "Content-Type": "image/png" }, data: png });
  expect(picture.status()).toBe(201);
  const { file_url } = await picture.json();
  const readId = /\/r\/([^/]+)\//.exec(file_url)![1];
  expect((await request.get(file_url)).status()).toBe(200);

  const res = await request.post("/api/operator/takedown", { headers: auth, data: { target: file_url } });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({ removed: true, notes: 2, images: 1, blocked: 1 });
  expect(body.image_keys).toHaveLength(1);

  expect((await request.get(file_url)).status()).toBe(410);
  expect((await request.get(`/r/${readId}/feed.xml`)).status()).toBe(410);
  await page.goto(`/r/${readId}`);
  await expect(page.getByRole("status")).toContainText("removed by the operator");
  await page.goto(`/${feed}`);
  await expect(page.getByRole("status")).toContainText("removed by the operator");
  await expect(page.getByLabel("Note in markdown")).toHaveCount(0);
  const again = await request.post(`/api/v1/feeds/${feed}/notes`, { headers: { "Content-Type": "text/markdown" }, data: "# Back?" });
  expect(again.status()).toBe(410);
  const other = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const blocked = await request.post(`/api/v1/feeds/${other}/notes`, { headers: { "Content-Type": "image/png" }, data: png });
  expect(blocked.status()).toBe(451);
  expect((await blocked.json()).code).toBe("blocked");
});

test("a note takedown (#159) leaves a mark the owner can delete, and the note's page still says it was removed", async ({ request, page }) => {
  const feed = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const png = Buffer.from(pngOf((Date.now() + 7) % 0x1000000)); // its own picture: the blocklist outlives the run
  expect((await request.post(`/api/v1/feeds/${feed}/notes`, { headers: { "Content-Type": "text/markdown" }, data: "# Stays" })).status()).toBe(201);
  const picture = await request.post(`/api/v1/feeds/${feed}/notes`, { headers: { "Content-Type": "image/png" }, data: png });
  const { id, file_url } = await picture.json();
  const readId = /\/r\/([^/]+)\//.exec(file_url)![1];

  const res = await request.post("/api/operator/takedown", { headers: auth, data: { target: file_url, scope: "note" } });
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ removed: true, notes: [id], blocked: 1 });
  expect((await request.get(file_url)).status()).toBe(410);

  const mark = "Removed by the operator: this broke the content rules of this instance.";
  await page.goto(`/r/${readId}`);
  await expect(page.getByText(mark)).toBeVisible();
  await expect(page.getByText("Stays")).toBeVisible();
  await page.goto(`/r/${readId}/${id}`);
  await expect(page.getByText(mark)).toBeVisible();

  await page.goto(`/${feed}/${id}`);
  await page.getByRole("button", { name: "Delete this mark" }).click();
  await expect(page).toHaveURL(new RegExp(`/${feed}\\?deleted=`));
  await expect(page.getByText(mark)).toHaveCount(0);
  await expect(page.getByText("Stays")).toBeVisible();
  await page.goto(`/r/${readId}`);
  await expect(page.getByText(mark)).toHaveCount(0);
  await page.goto(`/r/${readId}/${id}`);
  await expect(page.getByText(mark)).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete this mark" })).toHaveCount(0);
});
