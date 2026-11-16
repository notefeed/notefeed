// Accounts anyone may create (NOTEFEED_ACCOUNTS=open, #388): an account is a number with a recovery key and passkeys, and feeds
// keep working without one. The server is on port 3105 (playwright.config.ts).
import { type Page, expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

// A new account through the pages: the number and key, shown once, and "Continue" only after "I saved them".
async function createAccount(page: Page): Promise<{ number: string; key: string }> {
  await page.goto("/login");
  await page.getByRole("link", { name: "Create an account" }).click();
  await page.getByRole("button", { name: "Create account" }).click();
  const codes = page.locator("code");
  await expect(codes).toHaveCount(2);
  const [number, key] = await codes.allTextContents();
  expect(number).toMatch(/^\d{4}-\d{4}-\d{4}-\d{4}$/);
  expect(key).toMatch(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){4}$/);
  const go = page.getByRole("link", { name: "Continue" });
  await expect(go).toHaveAttribute("aria-disabled", "true");
  await page.getByLabel("I saved them").check();
  await go.click();
  return { number, key };
}

async function signInWithKey(page: Page, number: string, key: string, next = "/account") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Account number").fill(number);
  await page.getByLabel("Recovery key").fill(key);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

const logOut = async (page: Page) => {
  await page.goto("/account");
  await page.getByRole("button", { name: "Log out" }).click();
};

test("feeds work without an account: no sign-in in the way", async ({ page }) => {
  await page.goto("/e2e-accounts-open");
  await expect(page).toHaveURL(/\/e2e-accounts-open$/);
  await page.goto("/");
  await expect(page).not.toHaveURL(/\/login/);
});

test("create an account, log out, and sign back in with the number and key", async ({ page }) => {
  const { number, key } = await createAccount(page);
  await page.goto("/account");
  await expect(page.locator("code")).toHaveText(number);
  await logOut(page);
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login\?next=(%2F|\/)account/);
  await signInWithKey(page, number.replace(/-/g, " "), key.toLowerCase());
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.locator("code")).toHaveText(number);
});

test("a wrong key is refused with its message", async ({ page }) => {
  const { number } = await createAccount(page);
  await logOut(page);
  await signInWithKey(page, number, "AAAAA-AAAAA-AAAAA-AAAAA-AAAAA");
  await expect(page.locator("#login-error")).toHaveText("That account number and recovery key don't belong together.");
});

test("a new recovery key replaces the old one", async ({ page }) => {
  const { number, key } = await createAccount(page);
  await page.goto("/account");
  await page.getByRole("button", { name: "Make a new recovery key" }).click();
  const fresh = (await page.locator("code").nth(1).textContent())!;
  expect(fresh).not.toBe(key);
  await logOut(page);
  await signInWithKey(page, number, key);
  await expect(page).toHaveURL(/\/login\?error=auth/);
  await signInWithKey(page, number, fresh);
  await expect(page).toHaveURL(/\/account$/);
});

test("a passkey added while signed in signs in later", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the virtual authenticator is Chromium's");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true },
  });
  await createAccount(page);
  await page.goto("/account");
  await page.getByLabel("Name (optional)").fill("Work laptop");
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(1);
  // The virtual authenticator is of no known kind: "Passkey".
  await expect(page.getByText(/^Work laptop · Passkey, added /)).toBeVisible();
  await logOut(page);
  await page.goto("/login?next=/account");
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(page).toHaveURL(/\/account$/);
});

test("deleting the account needs its number, then it is gone", async ({ page }) => {
  const { number, key } = await createAccount(page);
  await page.goto("/account");
  await page.getByLabel("Type your account number to confirm").fill("1111-2222-3333-4444");
  await page.getByRole("button", { name: "Delete account" }).click();
  await expect(page.locator("#delete-error")).toHaveText("That isn't this account's number.");
  await page.getByLabel("Type your account number to confirm").fill(number);
  await page.getByRole("button", { name: "Delete account" }).click();
  await expect(page).toHaveURL(/\/$/);
  await signInWithKey(page, number, key);
  await expect(page).toHaveURL(/\/login\?error=auth/);
});

test("the ⓘ menu leads to the account when signed in, to sign-in when not", async ({ page }) => {
  await page.goto("/");
  await page.locator('summary[aria-label="About and legal"]').first().click();
  await expect(page.getByRole("link", { name: "Sign in or create an account" })).toBeVisible();
  await createAccount(page);
  await page.goto("/");
  await page.locator('summary[aria-label="About and legal"]').first().click();
  await expect(page.getByRole("link", { name: "Account" })).toBeVisible();
});

// Owners and their feed passwords (#389): a feed made while signed in is the account's; its settings list its passwords.
test("a feed made while signed in is yours: add a named password, use it, revoke it", async ({ page, baseURL }) => {
  await createAccount(page);
  const api = (path: string, init: { method?: string; data?: unknown; headers?: Record<string, string> } = {}) =>
    page.request.fetch(`/api/v1/feeds/${path}`, { method: init.method ?? "GET", data: init.data, headers: { origin: baseURL!, ...init.headers } });
  expect((await api("e2e-owned", { method: "POST", data: { password: "first-password" } })).status()).toBe(201);
  expect((await api("e2e-owned/notes", { method: "POST", data: "# hi", headers: { "content-type": "text/markdown" } })).status()).toBe(201);
  await page.goto("/e2e-owned/settings");
  await expect(page.getByText("This feed is yours")).toBeVisible();
  await expect(page.getByText("Feed password", { exact: true })).toBeVisible();
  await page.getByLabel("What it's for").fill("blog script");
  await page.getByRole("button", { name: "Add a password" }).click();
  const shown = page.locator("code").filter({ hasText: /^[A-Za-z0-9_-]{24}$/ });
  await expect(shown).toHaveCount(1);
  const secret = (await shown.textContent())!;
  await expect(page.getByText("blog script", { exact: true })).toBeVisible();
  const post = () =>
    page.request.fetch("/api/v1/feeds/e2e-owned/notes", {
      method: "POST",
      data: "# from the script",
      headers: { "content-type": "text/markdown", "x-feed-password": secret },
    });
  expect((await post()).status()).toBe(201);
  await page.getByRole("listitem").filter({ hasText: "blog script" }).getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText("blog script", { exact: true })).toHaveCount(0);
  expect((await post()).status()).toBe(401);
});

test("a protected feed is claimed with its password after unlocking it", async ({ page, browser, baseURL }) => {
  const anon = await browser.newContext({ baseURL });
  expect((await anon.request.post("/api/v1/feeds/e2e-claim", { data: { password: "claim-password" } })).status()).toBe(201);
  expect(
    (
      await anon.request.post("/api/v1/feeds/e2e-claim/notes", {
        data: "# hi",
        headers: { "content-type": "text/markdown", "x-feed-password": "claim-password" },
      })
    ).status(),
  ).toBe(201);
  await anon.close();
  await createAccount(page);
  await page.goto("/e2e-claim");
  await page.getByLabel("Password").fill("claim-password");
  await page.getByRole("button", { name: "Unlock" }).click();
  await page.goto("/e2e-claim/settings");
  await page.locator("#claim-password").fill("claim-password");
  await page.getByRole("button", { name: "Claim" }).click();
  await expect(page.getByText("This feed is yours")).toBeVisible();
});
