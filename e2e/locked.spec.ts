import { expect, test } from "@playwright/test";
import { mcp } from "./mcp";

const feed = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

test("login returns to the requested page, log out locks it again", async ({ page }) => {
  const name = feed();
  await page.goto(`/${name}`);
  await expect(page).toHaveURL(`/login?next=%2F${name}`);

  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.locator("#login-error")).not.toBeEmpty();
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel("Password").fill("e2e");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(`/${name}`);
  await expect(page.getByLabel("Note in markdown")).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await page.goto(`/${name}`);
  await expect(page).toHaveURL(/\/login/);
});

test("the read-only view and its RSS need no login", async ({ page, browser, request }) => {
  await page.goto("/login");
  await page.getByLabel("Password").fill("e2e");
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("/");
  await page.goto(`/${feed()}`);
  await page.getByLabel("Note in markdown").fill("# Public note");
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("link", { name: "Public note" })).toBeVisible();
  const readHref = await page.getByRole("link", { name: "Open read-only view" }).getAttribute("href");

  const anonymous = await browser.newPage();
  await anonymous.goto(new URL(readHref!, page.url()).href);
  await expect(anonymous.getByRole("link", { name: "Public note" })).toBeVisible();
  await expect(anonymous.getByRole("button", { name: "Log out" })).toHaveCount(0);

  // `request` shares no cookies with `page`: an anonymous feed reader.
  const rss = await request.get(new URL(`${readHref}/feed.xml`, page.url()).href, { maxRedirects: 0 });
  expect(rss.status()).toBe(200);
  const link = /<item>.*?<link>(.*?)<\/link>/s.exec(await rss.text())![1];
  await anonymous.goto(link);
  await expect(anonymous.getByText("Public note")).toBeVisible();
  await anonymous.close();
});

test("MCP: /mcp takes the password as a bearer, and points at Better Auth's OAuth server", async ({ request }) => {
  const anon = await request.post("/mcp", mcp("tools/list"));
  expect(anon.status()).toBe(401);
  expect(anon.headers()["www-authenticate"]).toBe('Bearer resource_metadata="http://localhost:3101/.well-known/oauth-protected-resource/mcp"');
  expect((await request.post("/mcp", mcp("tools/list", {}, { authorization: "Bearer wrong" }))).status()).toBe(401);
  expect((await request.post("/mcp", mcp("tools/list", {}, { authorization: "Bearer e2e" }))).status()).toBe(200);
  const resource = await (await request.get("/.well-known/oauth-protected-resource/mcp")).json();
  expect(resource.authorization_servers).toEqual(["http://localhost:3101/api/auth"]);
  const server = await request.get("/.well-known/oauth-authorization-server");
  expect((await server.json()).issuer).toBe("http://localhost:3101/api/auth");
  expect(server.headers()["access-control-allow-origin"]).toBe("*");
  // Of Better Auth only its OAuth server: no passkeys, no account sign-in.
  expect((await request.post("/api/auth/passkey/generate-authenticate-options")).status()).toBe(404);
});

// The OAuth login with the instance password (ADR 0062): Better Auth's server, the password on the authorize page, the code, the
// token, and /mcp with it.
test("MCP: the OAuth login page with the password, then a code whose token works on /mcp", async ({ page, request }) => {
  const meta = await (await request.get("/.well-known/oauth-authorization-server")).json();
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
    state: "xyz",
    resource: "http://localhost:3101/mcp",
    scope: "openid offline_access",
  });
  const response = await page.goto(`${meta.authorization_endpoint}?${params}`);
  expect(response!.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  await expect(page.getByRole("heading", { name: "Connect E2E client" })).toBeVisible();
  await page.getByLabel("Password").fill("e2e");
  const toClient = page.waitForRequest((r) => r.url().startsWith(redirect));
  await page.getByRole("button", { name: "Allow" }).click();
  const callback = new URL((await toClient).url());
  expect(callback.searchParams.get("state")).toBe("xyz");
  const tokens = await request.post(meta.token_endpoint, {
    form: {
      grant_type: "authorization_code",
      code: callback.searchParams.get("code")!,
      redirect_uri: redirect,
      client_id,
      code_verifier: verifier,
      resource: "http://localhost:3101/mcp",
    },
  });
  expect(tokens.status()).toBe(200);
  const { access_token } = await tokens.json();
  expect((await request.post("/mcp", mcp("tools/list", {}, { authorization: `Bearer ${access_token}` }))).status()).toBe(200);
});

test("with the login, a note can be edited and deleted from the browser", async ({ page }) => {
  const name = feed();
  await page.goto("/login");
  await page.getByLabel("Password").fill("e2e");
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("/");
  await page.goto(`/${name}`);
  await page.getByLabel("Note in markdown").fill("# Locked note");
  await page.getByRole("button", { name: "Post note" }).click();
  await page.getByRole("link", { name: "Locked note" }).click();
  await page.getByText("Edit", { exact: true }).click();
  await page.getByLabel("Note in markdown").fill("# Locked edited");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Locked edited" })).toBeVisible();
  await page.getByText("Delete", { exact: true }).click();
  await page.getByRole("button", { name: "Delete note" }).click();
  await expect(page.getByRole("status")).toHaveText("Note deleted.");
});
