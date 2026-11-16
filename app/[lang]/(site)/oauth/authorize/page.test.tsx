import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import AuthorizePage from "./page";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// With accounts (ADR 0062): Better Auth's signed request, the client it names and the account signed in, each set per test.
const ba = vi.hoisted(() => ({
  on: false,
  query: "client_id=x&sig=s" as string | null,
  account: undefined as { number?: string } | undefined,
}));
vi.mock("@/backend", async (orig) => ({
  ...(await orig<typeof import("@/backend")>()),
  accountsAuth: () => (ba.on ? {} : undefined),
  oauthQuery: async () => ba.query,
  oauthClient: async () => ({ name: "Claude", redirectHost: "claude.ai" }),
  accountOf: async () => ba.account,
}));

beforeEach(() => {
  Object.assign(ba, { on: false, query: "client_id=x&sig=s", account: undefined });
});
afterEach(() => vi.unstubAllEnvs());

const render = async (q: Record<string, string>) =>
  renderToStaticMarkup(
    await AuthorizePage({ params: Promise.resolve({ lang: "en" }), searchParams: Promise.resolve(q) } as PageProps<"/[lang]/oauth/authorize">),
  );

test("without accounts there is no page", async () => {
  await expect(render({ client_id: "x" })).rejects.toThrow();
});

test("with accounts, signed out: a link to sign in that comes back with Better Auth's signed request; no form", async () => {
  ba.on = true;
  const html = await render({ client_id: "x", sig: "s" });
  expect(html).toContain("Connect Claude");
  expect(html).toContain(`href="/login?next=${encodeURIComponent("/oauth/authorize?client_id=x&sig=s")}"`);
  expect(html).not.toContain("<form");
  expect(html).not.toContain('name="password"');
});

test("with accounts, signed in: Allow and Deny post the signed request, and say which account", async () => {
  Object.assign(ba, { on: true, account: { number: "4821-0937-5521-7764" } });
  const html = await render({ client_id: "x", sig: "s" });
  expect(html).toContain('<input type="hidden" name="oauth_query" value="client_id=x&amp;sig=s"/>');
  expect(html).toMatch(/value="1"[^>]*name="accept">Allow as your account</);
  expect(html).toMatch(/value="0"[^>]*name="accept">Deny</);
  expect(html).toContain("account 4821-0937-5521-7764");
});

test("with accounts, a request Better Auth didn't sign, or no longer would: the expired message", async () => {
  Object.assign(ba, { on: true, query: null });
  const html = await render({ client_id: "x" });
  expect(html).toContain("This sign-in has expired");
  expect(html).not.toContain("<form");
});
