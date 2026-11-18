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

test("the owner's name on their notes, and their feeds in the side bar", async ({ page, baseURL }) => {
  await createAccount(page);
  const headers = { origin: baseURL! };
  expect((await page.request.post("/api/v1/feeds/e2e-named", { data: {}, headers })).status()).toBe(201);
  expect(
    (await page.request.post("/api/v1/feeds/e2e-named/notes", { data: "# mine", headers: { ...headers, "content-type": "text/markdown" } })).status(),
  ).toBe(201);
  await page.goto("/e2e-named/settings");
  await page.getByLabel("Your name on your notes").fill("Ann");
  await page.getByRole("button", { name: "Save" }).first().click();
  await expect(page).toHaveURL(/saved=1/);
  await page.goto("/e2e-named");
  await expect(page.getByText("Ann", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("complementary").getByText("e2e-named", { exact: true })).toBeVisible();
});

test("an account token made on the account page lets a script act as the account", async ({ page, playwright, baseURL }) => {
  await createAccount(page);
  await page.goto("/account");
  await page.getByLabel("What it's for").fill("backup script");
  await page.getByRole("button", { name: "Make a token" }).click();
  const shown = page.locator("code").filter({ hasText: /^nf_/ });
  await expect(shown).toHaveCount(1);
  const token = (await shown.textContent())!;
  const script = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { authorization: `Bearer ${token}` } });
  expect((await script.post("/api/v1/feeds/e2e-scripted", { data: {} })).status()).toBe(201);
  expect(await (await script.get("/api/v1/account/feeds")).json()).toEqual({ feeds: ["e2e-scripted"] });
  await script.dispose();
  await page.reload();
  await expect(page.getByText("backup script", { exact: true })).toBeVisible();
});

// An MCP client signs in as an account through Better Auth's OAuth server (ADR 0062): discovery, registration, the authorize page
// (signed out: sign in and come back; signed in: Allow), the code, the token, and /mcp acting as the account.
test("an MCP client connects as an account: sign in on the way, Allow, and its token works on /mcp", async ({ page, request, baseURL }) => {
  const { number, key } = await createAccount(page);
  await logOut(page);
  const meta = await (await request.get("/.well-known/oauth-authorization-server")).json();
  expect(meta.issuer).toBe(`${baseURL}/api/auth`);
  expect((await (await request.get("/.well-known/oauth-protected-resource/mcp")).json()).authorization_servers).toEqual([meta.issuer]);
  const redirect = "http://127.0.0.1:9/callback";
  const reg = await request.post(meta.registration_endpoint, {
    data: { client_name: "E2E client", redirect_uris: [redirect], token_endpoint_auth_method: "none" },
  });
  expect(reg.status()).toBe(201);
  const { client_id } = await reg.json();
  const verifier = "v".repeat(43);
  const challenge = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).toString("base64url");
  const params = new URLSearchParams({
    response_type: "code",
    client_id,
    redirect_uri: redirect,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "e2e",
    resource: `${baseURL}/mcp`,
    scope: "openid offline_access",
  });
  await page.goto(`${meta.authorization_endpoint}?${params}`);
  await expect(page.getByRole("heading", { name: "Connect E2E client" })).toBeVisible();
  // The page that grants access can't be framed (clickjacking).
  expect((await page.request.get(page.url())).headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  await page.getByRole("link", { name: "Sign in to your account first" }).click();
  await page.getByLabel("Account number").fill(number);
  await page.getByLabel("Recovery key").fill(key);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Connect E2E client" })).toBeVisible();
  await expect(page.getByText(`account ${number}`)).toBeVisible();
  // The client's redirect_uri isn't served: the code is read off the request the browser makes to it.
  const toClient = page.waitForRequest((r) => r.url().startsWith(redirect));
  await page.getByRole("button", { name: "Allow as your account" }).click();
  const callback = new URL((await toClient).url());
  expect(callback.searchParams.get("state")).toBe("e2e");
  const tokens = await request.post(meta.token_endpoint, {
    form: {
      grant_type: "authorization_code",
      code: callback.searchParams.get("code")!,
      redirect_uri: redirect,
      client_id,
      code_verifier: verifier,
      resource: `${baseURL}/mcp`,
    },
  });
  expect(tokens.status()).toBe(200);
  const { access_token } = await tokens.json();
  const V = "2026-07-28";
  const mcp = await request.post("/mcp", {
    headers: {
      authorization: `Bearer ${access_token}`,
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": V,
      "mcp-method": "tools/call",
      "mcp-name": "list_feeds",
    },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "list_feeds",
        arguments: {},
        _meta: {
          "io.modelcontextprotocol/clientInfo": { name: "e2e", version: "0" },
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/protocolVersion": V,
        },
      },
    },
  });
  expect(mcp.status()).toBe(200);
  expect((await mcp.json()).result.isError).toBeFalsy();
});
