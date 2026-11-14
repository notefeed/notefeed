import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { locked } from "../auth";
import { accountsMode, accountsOn, checkAccessSettings } from "./mode";

const PROVIDER = {
  NOTEFEED_OIDC_ISSUER: "https://idp.example",
  NOTEFEED_OIDC_CLIENT_ID: "id",
  NOTEFEED_OIDC_CLIENT_SECRET: "secret",
  NOTEFEED_OIDC_ALLOW: "*",
};
const stub = (env: Record<string, string>) => Object.entries(env).forEach(([k, v]) => vi.stubEnv(k, v));
beforeEach(() => {
  vi.stubEnv("NOTEFEED_PASSWORD", "");
  vi.stubEnv("NOTEFEED_ACCOUNTS", "");
  vi.stubEnv("PUBLIC_URL", "https://notes.example");
});
afterEach(() => vi.unstubAllEnvs());

test("accounts are off by default, and an instance with nothing set is open", () => {
  expect(accountsMode()).toBe("off");
  expect(accountsOn()).toBe(false);
  expect(locked()).toBe(false);
  expect(() => checkAccessSettings()).not.toThrow();
});

test("an identity provider without the setting means provider mode, which locks the instance as before", () => {
  stub(PROVIDER);
  expect(accountsMode()).toBe("provider");
  expect(locked()).toBe(true);
});

test("open accounts don't lock the instance: open feeds work without an account", () => {
  vi.stubEnv("NOTEFEED_ACCOUNTS", "open");
  expect(accountsOn()).toBe(true);
  expect(locked()).toBe(false);
});

test("closed accounts lock the instance", () => {
  vi.stubEnv("NOTEFEED_ACCOUNTS", "closed");
  expect(locked()).toBe(true);
});

test("the setting is read case-insensitively and trimmed; anything else refuses to start, naming the variable", () => {
  vi.stubEnv("NOTEFEED_ACCOUNTS", " Open ");
  expect(accountsMode()).toBe("open");
  vi.stubEnv("NOTEFEED_ACCOUNTS", "yes");
  expect(() => checkAccessSettings()).toThrow(/NOTEFEED_ACCOUNTS must be one of off, open, provider, closed/);
});

test.each([
  ["open", {}],
  ["closed", {}],
  ["", PROVIDER],
  ["open", PROVIDER],
])("an instance password together with accounts (%s) refuses to start, saying to pick one", (mode, env) => {
  stub({ NOTEFEED_PASSWORD: "pw", NOTEFEED_ACCOUNTS: mode, ...env });
  expect(() => checkAccessSettings()).toThrow(/NOTEFEED_PASSWORD or accounts, not both/);
});

test("provider mode without a configured provider refuses to start", () => {
  vi.stubEnv("NOTEFEED_ACCOUNTS", "provider");
  expect(() => checkAccessSettings()).toThrow(/NOTEFEED_ACCOUNTS=provider needs an identity provider/);
});

test("accounts off with an identity provider configured refuses to start: a provider sign-in is an account", () => {
  stub({ NOTEFEED_ACCOUNTS: "off", ...PROVIDER });
  expect(() => checkAccessSettings()).toThrow(/identity provider .* needs accounts/);
});

test("accounts without PUBLIC_URL refuse to start", () => {
  stub({ NOTEFEED_ACCOUNTS: "open", PUBLIC_URL: "" });
  expect(() => checkAccessSettings()).toThrow(/need PUBLIC_URL/);
});

test("the instance password alone is as before", () => {
  vi.stubEnv("NOTEFEED_PASSWORD", "pw");
  expect(accountsOn()).toBe(false);
  expect(locked()).toBe(true);
  expect(() => checkAccessSettings()).not.toThrow();
});
