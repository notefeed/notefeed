import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// Sharing to notefeed from another app (issue #148): the installed app's share target POSTs a form to /api/share, which only the
// service worker (public/sw.js) answers. Here the page submits that form itself, as Android does: a navigation the worker takes.
type Shared = { name: string; mimeType: string; buffer: Buffer };
const PNG: Shared = { name: "pixel.png", mimeType: "image/png", buffer: readFileSync("e2e/fixtures/pixel.png") };
const text = (name: string): Shared => ({ name, mimeType: "text/plain", buffer: Buffer.from("not a picture") });

async function controlled(page: Page) {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

async function share(page: Page, fields: Record<string, string>, files: Shared[] = []) {
  await controlled(page);
  await page.evaluate((fields) => {
    const form = document.createElement("form");
    Object.assign(form, { method: "post", enctype: "multipart/form-data", action: "/api/share" });
    for (const [name, value] of Object.entries(fields)) form.append(Object.assign(document.createElement("input"), { type: "hidden", name, value }));
    form.append(Object.assign(document.createElement("input"), { type: "file", name: "files", multiple: true, id: "share-files" }));
    document.body.append(form);
  }, fields);
  if (files.length) await page.setInputFiles("#share-files", files);
  await Promise.all([page.waitForURL((u) => u.pathname === "/" && u.search !== ""), page.evaluate(() => document.querySelector<HTMLFormElement>("form[action='/api/share']")!.submit())]);
}

const stored = (page: Page) => page.evaluate(async () => (await (await caches.open("notefeed-share")).keys()).length);

test("a picture shared to notefeed waits in the browser and the start page asks for the feed", async ({ page }) => {
  await share(page, { share_text: "hello" }, [PNG]);
  expect(new URL(page.url()).search).toBe("?share_text=hello&shared=1");
  await expect(page.getByRole("heading", { name: "Open or create a feed" })).toBeVisible();
  expect(await stored(page)).toBe(1);
});

test("text shared without pictures lands as before", async ({ page }) => {
  await share(page, { share_title: "T" });
  expect(new URL(page.url()).search).toBe("?share_title=T");
  expect(await stored(page)).toBe(0);
});

test("a file that is no picture is left out", async ({ page }) => {
  await share(page, {}, [PNG, text("notes.txt")]);
  expect(await stored(page)).toBe(1);
});

test("a new share replaces the last one", async ({ page }) => {
  await share(page, {}, [PNG, PNG]);
  expect(await stored(page)).toBe(2);
  await share(page, {}, [PNG]);
  expect(await stored(page)).toBe(1);
});
