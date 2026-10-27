import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const PNG = "e2e/fixtures/pixel.png";
const feedName = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const note = (page: Page) => page.getByLabel("Note in markdown");

async function post(page: Page, name: string, markdown: string) {
  await page.goto(`/${name}`);
  await note(page).fill(markdown);
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("link", { name: markdown.replace(/^# /, "").split("\n")[0] })).toBeVisible();
}

async function choose(page: Page, button: string, file: string | { name: string; mimeType: string; buffer: Buffer } | string[]) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: button }).click();
  await (await chooser).setFiles(file);
}

// Files dropped on the textarea, as a browser makes the event: the fixture PNG under each name.
async function drop(page: Page, ...names: string[]) {
  const png = readFileSync(PNG).toString("base64");
  await note(page).evaluate(
    (ta, { png, names }) => {
      const data = new DataTransfer();
      for (const name of names) data.items.add(new File([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], name, { type: "image/png" }));
      ta.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
    },
    { png, names },
  );
}

const loaded = (img: ReturnType<Page["locator"]>) => expect.poll(() => img.first().evaluate((i: HTMLImageElement) => i.naturalWidth));

test("a new feed offers the same box as any feed, with the password field and the image button", async ({ page }) => {
  await page.goto(`/${feedName()}`);
  await expect(note(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add image" })).toBeVisible();
  await expect(page.getByLabel("Password (optional, protects this feed)")).toBeVisible();
});

test("dropped images wait in the box; removing one takes its reference out; posting makes one note per image and the text", async ({ page, request }) => {
  const name = feedName();
  await page.goto(`/${name}`);
  await note(page).fill("# Pictured\n\nbefore");
  await drop(page, "cat.png", "dog.png");
  await expect(note(page)).toHaveValue(/!\[\]\(cat\.png\)[\s\S]*!\[\]\(dog\.png\)/);
  const waiting = page.getByRole("list", { name: "Images to post" });
  await expect(waiting.getByRole("listitem")).toHaveCount(2);
  await page.getByRole("button", { name: "Remove dog.png" }).click();
  await expect(note(page)).not.toHaveValue(/dog\.png/);
  await expect(waiting.getByRole("listitem")).toHaveCount(1);
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("link", { name: "Pictured" })).toBeVisible();
  // The picture is a note of its own, shown once: inside the markdown note, not listed again.
  await expect(page.locator(".md img")).toBeVisible();
  await loaded(page.locator(".md img")).toBeGreaterThan(0);
  await expect(page.locator("ol > li")).toHaveCount(1);
  await expect(page.locator("ol > li img")).toHaveCount(1);
  expect((await (await request.get(`/api/v1/feeds/${name}/notes`)).json()).notes).toHaveLength(2); // the text and the picture
  await page.getByRole("link", { name: "Open read-only view" }).click();
  await expect(page).toHaveURL(/\/r\/[^/]+$/);
  await expect(page.locator("ol > li img")).toHaveCount(1);
  await loaded(page.locator("ol > li img")).toBeGreaterThan(0);
});

test("more than 10 pictures: the first 10 wait in the box, and the box says why the rest do not", async ({ page }) => {
  await page.goto(`/${feedName()}`);
  await drop(page, ...Array.from({ length: 11 }, (_, i) => `p${i}.png`));
  await expect(page.getByRole("list", { name: "Images to post" }).getByRole("listitem")).toHaveCount(10);
  await expect(page.getByRole("alert").filter({ hasText: "A note can have at most 10 pictures." })).toBeVisible();
  await expect(note(page)).toHaveValue(/p9\.png/);
  await expect(note(page)).not.toHaveValue(/p10\.png/);
  // One taken out: the box is under the limit again, so the message goes.
  await page.getByRole("button", { name: "Remove p3.png" }).click();
  await expect(page.getByRole("list", { name: "Images to post" }).getByRole("listitem")).toHaveCount(9);
  await expect(page.getByRole("alert").filter({ hasText: "A note can have at most 10 pictures." })).toHaveCount(0);
});

test("leaving the page without posting uploads nothing", async ({ page }) => {
  const name = feedName();
  const uploads: string[] = [];
  page.on("request", (r) => r.method() === "POST" && uploads.push(r.url()));
  await page.goto(`/${name}`);
  await drop(page, "cat.png");
  await expect(page.getByRole("list", { name: "Images to post" }).getByRole("listitem")).toHaveCount(1);
  await page.reload();
  await expect(note(page)).toHaveValue("");
  expect(uploads).toEqual([]);
  await expect(page.getByText("No notes yet")).toBeVisible();
});

test("only images, no text: posts the image notes and nothing else", async ({ page }) => {
  const name = feedName();
  await page.goto(`/${name}`);
  await choose(page, "Add image", PNG);
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.locator("ol > li img")).toHaveCount(1);
  await expect(page.locator(".md")).toHaveCount(0);
  // The answer was the first picture's: ?posted= carries its note id, and that note is the picture.
  await expect(page).toHaveURL(/\?posted=[A-Za-z0-9_-]{22}$/);
  await page.goto(`/${name}/${new URL(page.url()).searchParams.get("posted")}`);
  await expect(page.locator("article img")).toBeVisible();
});

test("a new feed takes images and a password in its first post", async ({ page }) => {
  const name = feedName();
  await page.goto(`/${name}`);
  await note(page).fill("# Locked pictures");
  await choose(page, "Add image", PNG);
  await page.getByLabel("Password (optional, protects this feed)").fill("hunter22");
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("link", { name: "Locked pictures" })).toBeVisible();
  await expect(page.locator("ol > li")).toHaveCount(1); // the text, with the picture in it
  await expect(page.locator(".md img")).toBeVisible();
  await page.context().clearCookies();
  await page.goto(`/${name}`);
  await expect(page.getByLabel("Feed password")).toBeVisible(); // protected: asks for it
  await expect(page.getByRole("link", { name: "Locked pictures" })).toHaveCount(0);
});

test("two pictures and a text that refers to one go in one request: the text shows both, each picture is a note", async ({ page }) => {
  const name = feedName();
  const posts: string[] = [];
  page.on("request", (r) => r.method() === "POST" && r.url().endsWith("/notes") && posts.push(r.headers()["content-type"] ?? ""));
  await page.goto(`/${name}`);
  await drop(page, "one.png", "two.png");
  await note(page).fill("# Two pictured\n\nsee ![](one.png) here");
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("link", { name: "Two pictured" })).toBeVisible();
  await expect(page.locator("ol > li")).toHaveCount(1); // the text; one.png and two.png are notes of their own, shown in it
  await expect(page.locator(".md img")).toHaveCount(2); // one.png where the text refers to it, two.png appended
  await loaded(page.locator(".md img")).toBeGreaterThan(0);
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatch(/^multipart\/form-data; boundary=/);
});

test("a picture the server refuses posts nothing: the box says which, and keeps the text and the pictures", async ({ page }) => {
  const name = feedName();
  await post(page, name, "# Before");
  await note(page).fill("# Half posted?");
  await drop(page, "good.png");
  await choose(page, "Add image", { name: "a.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "a.png: Only PNG, JPEG, GIF and WebP" })).toBeVisible();
  await expect(note(page)).toHaveValue(/Half posted\?[\s\S]*good\.png[\s\S]*a\.png/);
  await expect(page.getByRole("list", { name: "Images to post" }).getByRole("listitem")).toHaveCount(2);
  await page.reload();
  await expect(page.locator("ol > li")).toHaveCount(1); // only the note from before
  await expect(page.getByRole("link", { name: "Half posted?" })).toHaveCount(0);
});

test("a text file chosen as an image is refused when posting, and stays in the box", async ({ page }) => {
  await post(page, feedName(), "# Refusing");
  await choose(page, "Add image", { name: "a.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Only PNG, JPEG, GIF and WebP" })).toBeVisible();
  await expect(note(page)).toHaveValue("![](a.png)");
});

test("editing a note offers the same control, and saving posts the picture", async ({ page }) => {
  const name = feedName();
  await post(page, name, "# Editable");
  await page.getByRole("link", { name: "Editable" }).click();
  await page.getByText("Edit", { exact: true }).click();
  await choose(page, "Add image", PNG);
  await expect(note(page)).toHaveValue(/!\[\]\(pixel\.png\)/);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await loaded(page.locator(".md img")).toBeGreaterThan(0);
});

test("a note's text replaced by just a new picture's reference stays a text note, holding the picture", async ({ page, request }) => {
  const name = feedName();
  await post(page, name, "# Only words");
  await page.getByRole("link", { name: "Only words" }).click();
  await expect(page).toHaveURL(new RegExp(`/${name}/[^/?]+$`)); // the click navigates in the page: wait for the note's own address
  const url = page.url();
  await page.getByText("Edit", { exact: true }).click();
  await note(page).fill("");
  await choose(page, "Add image", PNG);
  await expect(note(page)).toHaveValue("![](pixel.png)");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await loaded(page.locator(".md img")).toBeGreaterThan(0);
  await page.goto(url); // the same note, read again: still a text to edit, its reference now the stored file
  await page.getByText("Edit", { exact: true }).click();
  await expect(note(page)).toHaveValue(/^!\[\]\([A-Za-z0-9_-]{22}\.png\)$/);
  await page.goto(`/${name}`);
  await expect(page.locator("ol > li")).toHaveCount(1); // the text note, holding the picture
  expect((await (await request.get(`/api/v1/feeds/${name}/notes`)).json()).notes).toHaveLength(2); // the text note and the picture
});

test("a picture the server refuses when saving: the editor says which, and the note and the feed stay as they were", async ({ page }) => {
  const name = feedName();
  await post(page, name, "# Unchanged");
  await page.getByRole("link", { name: "Unchanged" }).click();
  await expect(page).toHaveURL(new RegExp(`/${name}/[^/?]+$`)); // the click navigates in the page: wait for the note's own address
  const url = page.url();
  await page.getByText("Edit", { exact: true }).click();
  await choose(page, "Add image", { name: "a.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
  await expect(note(page)).toHaveValue(/!\[\]\(a\.png\)/);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "a.png: Only PNG, JPEG, GIF and WebP" })).toBeVisible();
  await page.goto(url);
  await page.getByText("Edit", { exact: true }).click();
  await expect(note(page)).toHaveValue("# Unchanged");
  await page.goto(`/${name}`);
  await expect(page.locator("ol > li")).toHaveCount(1);
});

test("a title that fails to save after a picture was added: saving again stores the picture once", async ({ page, request }) => {
  const name = feedName();
  await post(page, name, "# Retried");
  await page.getByRole("link", { name: "Retried" }).click();
  await page.getByText("Edit", { exact: true }).click();
  await page.getByLabel("Title (optional, otherwise taken from the text)").fill("New title");
  await choose(page, "Add image", PNG);
  let failed = false;
  await page.route("**/notes/*", (route) => {
    if (route.request().method() !== "PATCH" || failed) return route.continue();
    failed = true;
    return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "x", code: "x" }) });
  });
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Something went wrong." })).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await page.goto(`/${name}`);
  await expect(page.getByRole("link", { name: "New title" })).toBeVisible();
  expect((await (await request.get(`/api/v1/feeds/${name}/notes`)).json()).notes).toHaveLength(2); // the text note and one picture, not two
});

// A paste event as a browser makes it: a clipboard holding the fixture PNG, and `text` when given.
async function paste(page: Page, text?: string) {
  const png = readFileSync(PNG).toString("base64");
  await note(page).evaluate(
    (ta, { png, text }) => {
      const data = new DataTransfer();
      data.items.add(new File([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], "clip.png", { type: "image/png" }));
      if (text) data.setData("text/plain", text);
      ta.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    },
    { png, text },
  );
}

test("pasting an image adds it to the box", async ({ page }) => {
  await page.goto(`/${feedName()}`);
  await paste(page);
  await expect(note(page)).toHaveValue("![](clip.png)");
  await expect(page.getByRole("list", { name: "Images to post" }).getByRole("listitem")).toHaveCount(1);
});

test("pasting a clipboard that also holds text adds no image", async ({ page }) => {
  await page.goto(`/${feedName()}`);
  await paste(page, "copied cells");
  await expect(page.getByRole("list", { name: "Images to post" })).toHaveCount(0);
  await expect(note(page)).toHaveValue("");
});

test("a title image shows in the header and the read-only view, and can be removed", async ({ page }) => {
  const name = feedName();
  await post(page, name, "# Titled");
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Typed, not saved"); // choosing an image keeps what is typed
  await page.locator("summary", { hasText: "Title image" }).click();
  await choose(page, "Choose image", PNG);
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Typed, not saved");
  const header = page.locator("header img:not([src=\"/icon.svg\"])");
  await expect(header).toBeVisible();
  expect(await header.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole("link", { name: "Open read-only view" }).click();
  await expect(page).toHaveURL(/\/r\/[^/]+$/);
  await expect(page.locator("header img:not([src=\"/icon.svg\"])")).toBeVisible();
  await expect(page.locator("ol > li img")).toHaveCount(0); // the feed's own image, not a post (#310)
  await page.goto(`/${name}`);
  await expect(page.locator("ol > li")).toHaveCount(1);
  await page.goto(`/${name}/settings`); // not goBack: where it lands depends on timing
  await page.locator("summary", { hasText: "Title image" }).click();
  await page.getByRole("button", { name: "Remove image" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await expect(page.locator("header img:not([src=\"/icon.svg\"])")).toHaveCount(0);
  await page.getByRole("link", { name: "Open read-only view" }).click();
  await expect(page).toHaveURL(/\/r\/[^/]+$/);
  await expect(page.locator("header img:not([src=\"/icon.svg\"])")).toHaveCount(0);
});

// A noisy 4000×3000 JPEG: about 11 MB, as a phone's camera makes them, over the 5 MiB image limit.
async function cameraPhoto(page: Page) {
  const b64 = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    [c.width, c.height] = [4000, 3000];
    const x = c.getContext("2d")!;
    const d = x.createImageData(c.width, c.height);
    for (let i = 0; i < d.data.length; i++) d.data[i] = Math.random() * 255;
    x.putImageData(d, 0, 0);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.95));
    return await new Promise<string>((r) => {
      const reader = new FileReader();
      reader.onload = () => r((reader.result as string).split(",")[1]); // base64: an array of 11 million numbers is too much to send back
      reader.readAsDataURL(blob);
    });
  });
  const buffer = Buffer.from(b64, "base64");
  expect(buffer.length).toBeGreaterThan(5 * 1024 * 1024);
  return { name: "IMG_0001.jpg", mimeType: "image/jpeg", buffer };
}

// What the server stores for an image on the page: at most 1 MB, as the browser sends it.
async function storedBytes(page: Page, img: ReturnType<Page["locator"]>) {
  const src = await img.getAttribute("src");
  return (await (await page.request.get(src!)).body()).length;
}

// The browser shrinks every picture to NOTEFEED_SHRINK_IMAGE_BYTES (1 MiB by default) before it goes up, so a photo straight from a camera is taken.
test("a title image chosen from a phone's camera is shrunk to 1 MB and taken", async ({ page }) => {
  const name = feedName();
  await post(page, name, "# Phone");
  await page.setViewportSize({ width: 390, height: 844 }); // after posting: a phone has the compose bar as well as the box
  await page.goto(`/${name}/settings`);
  const photo = await cameraPhoto(page);
  await page.locator("summary", { hasText: "Title image" }).click();
  await choose(page, "Choose image", photo);
  await expect(page.getByRole("status")).toHaveText("Saved.");
  const header = page.locator("header img:not([src=\"/icon.svg\"])");
  await expect(header).toBeVisible();
  expect(await storedBytes(page, header)).toBeLessThanOrEqual(1024 * 1024);
});

test("a camera photo added in the compose box is shrunk to 1 MB and posted", async ({ page }) => {
  await page.goto(`/${feedName()}`);
  await choose(page, "Add image", await cameraPhoto(page));
  await page.getByRole("button", { name: "Post note" }).click();
  const img = page.locator("ol > li img");
  await expect(img).toHaveCount(1);
  expect(await storedBytes(page, img)).toBeLessThanOrEqual(1024 * 1024);
});

test("a title typed in the compose box is the note's title in the list", async ({ page }) => {
  const name = feedName();
  await page.goto(`/${name}`);
  await note(page).fill("# Derived heading\nbody");
  await page.getByLabel("Title (optional, otherwise taken from the text)").fill("Chosen title");
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("link", { name: "Chosen title" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Derived heading" })).toHaveCount(0);
});

test("the title of an image note can be set and changed on its page", async ({ page }) => {
  const name = feedName();
  await page.goto(`/${name}`);
  await choose(page, "Add image", PNG);
  await page.getByRole("button", { name: "Post note" }).click();
  await page.locator("ol > li a").first().click(); // the picture links to its page
  await expect(page.locator("article img")).toBeVisible();
  await page.getByText("Edit", { exact: true }).click();
  await expect(page.getByLabel("Note in markdown")).toHaveCount(0); // a picture has no text to edit
  await page.getByLabel("Title (optional)").fill("A pixel");
  await page.getByLabel("Alternative text (optional, for screen readers)").fill("one red pixel");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await expect(page.getByRole("heading", { name: "A pixel" })).toBeVisible();
  await expect(page.locator("article img")).toHaveAttribute("alt", "one red pixel");
});

test("the title image can be picked from the feed's images, and goes when its note is deleted", async ({ page }) => {
  const name = feedName();
  await post(page, name, "# Has pictures");
  await choose(page, "Add image", PNG);
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.locator("ol > li")).toHaveCount(2); // the picture is a note; its lone reference is no text note
  await expect(page.locator("ol > li img")).toHaveCount(1);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.locator("summary", { hasText: "Title image" }).click();
  await page.getByRole("button", { name: /^Use .* as the title image$/ }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await expect(page.locator("header img:not([src=\"/icon.svg\"])")).toBeVisible();
  await page.goto(`/${name}`);
  await page.locator("ol > li a").first().click();
  await page.getByText("Delete", { exact: true }).click();
  await page.getByRole("button", { name: "Delete note" }).click();
  await expect(page).toHaveURL(new RegExp(`/${name}\\?deleted=`));
  await expect(page.locator("header img:not([src=\"/icon.svg\"])")).toHaveCount(0);
});

// The note box takes the focus and puts the cursor behind a picture's reference in the same step as the reference goes in (#164), so
// that typing goes on behind it, and a selection made or a field moved to afterwards is never undone by a step coming late.
test("adding a picture puts the cursor behind its reference at once; typing goes on from there, and in another field stays there", async ({ page }) => {
  await page.goto(`/${feedName()}`);
  await choose(page, "Add image", PNG);
  await expect(note(page)).toHaveValue("![](pixel.png)");
  await expect(note(page)).toBeFocused();
  expect(await note(page).evaluate((ta: HTMLTextAreaElement) => [ta.selectionStart, ta.selectionEnd])).toEqual([14, 14]);
  await page.keyboard.type("\nafter");
  await expect(note(page)).toHaveValue("![](pixel.png)\nafter");
  const title = page.getByLabel("Title (optional, otherwise taken from the text)");
  await title.focus();
  await page.keyboard.insertText("Café");
  await expect(title).toHaveValue("Café");
  await expect(note(page)).toHaveValue("![](pixel.png)\nafter");
});

test("a title and tags typed with only pictures go on the pictures, accents included", async ({ page }) => {
  const name = feedName();
  await page.goto(`/${name}`);
  await choose(page, "Add image", PNG);
  await page.getByLabel("Title (optional, otherwise taken from the text)").fill("Café 日本語");
  await page.getByLabel("Tags (optional, separated by commas)").fill("pets, cats");
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("link", { name: "Café 日本語" }).first()).toBeVisible(); // the title, and the picture named by it
  await expect(page.getByRole("link", { name: "pets", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "cats", exact: true })).toBeVisible();
  await expect(page.locator("ol > li")).toHaveCount(1); // no text note
});

test("the preview shows a dropped picture from its file, before it is uploaded", async ({ page }) => {
  await page.goto(`/${feedName()}`);
  await note(page).fill("# With a picture");
  await drop(page, "cat.png");
  await page.getByRole("button", { name: "Preview" }).click();
  const img = page.getByRole("region", { name: "Preview" }).locator("img");
  await expect(img).toHaveAttribute("src", /^blob:/);
  await loaded(img).toBeGreaterThan(0);
});

// A picture posted with a markdown note is a note of its own; the feed shows it once, inside the note, and that picture leads to
// the picture's own page.
test("a note's picture shows once in the feed; clicking it opens the note, and there the picture's own note", async ({ page, request }) => {
  const name = feedName();
  const bytes = readFileSync(PNG);
  const res = await request.post(`/api/v1/feeds/${name}/notes`, { multipart: { text: "# Herzii\n\n![](beach.png)", file: { name: "beach.png", mimeType: "image/png", buffer: bytes } } });
  expect(res.status()).toBe(201);
  const posted = await res.json();
  const picture = posted.attachments[0];
  expect((await request.get(`/api/v1/feeds/${name}/notes`)).ok()).toBe(true);

  await page.goto(`/${name}`);
  await expect(page.getByRole("listitem")).toHaveCount(1); // the markdown note; the picture is not listed again
  await expect(page.locator("main img")).toHaveCount(1);
  await page.locator("main img").click();
  await expect(page).toHaveURL(new RegExp(`/${name}/${posted.id}$`)); // the note first
  await page.locator("main img").click();
  await expect(page).toHaveURL(new RegExp(`/${name}/${picture.id}$`)); // then the picture's own note
});
