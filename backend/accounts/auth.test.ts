import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { accountsAuth, authRoute, migrateAccounts } from "./auth";

const PROVIDER = {
  NOTEFEED_OIDC_ISSUER: "https://idp.example",
  NOTEFEED_OIDC_CLIENT_ID: "id",
  NOTEFEED_OIDC_CLIENT_SECRET: "secret",
  NOTEFEED_OIDC_ALLOW: "*",
};
const H = { host: "localhost:3000", origin: "http://localhost:3000" };
const tables = (path: string) => {
  const db = new Database(path, { readonly: true });
  try {
    return db
      .prepare("select name from sqlite_master where type = 'table'")
      .all()
      .map((r) => (r as { name: string }).name);
  } finally {
    db.close();
  }
};

let saved: NodeJS.ProcessEnv;
beforeEach(() => {
  saved = { ...process.env };
  process.env.NOTEFEED_SECRET = "s".repeat(32);
  process.env.PUBLIC_URL = "http://localhost:3000";
});
afterEach(() => {
  process.env = saved;
});
const withProvider = () => Object.assign(process.env, PROVIDER);

describe("without a sign-in provider", () => {
  test("accountsAuth() is undefined", () => {
    expect(accountsAuth()).toBeUndefined();
  });

  test("authRoute answers 404", async () => {
    const res = await authRoute(new Request("http://localhost:3000/api/auth/ok", { headers: H }));
    expect(res.status).toBe(404);
  });

  test("migrateAccounts creates no file", async () => {
    await migrateAccounts();
    expect(existsSync(join(process.env.DATA_DIR!, "accounts.sqlite"))).toBe(false);
  });
});

describe("with a sign-in provider", () => {
  beforeEach(withProvider);

  test("migrateAccounts creates DATA_DIR/accounts.sqlite with Better Auth's tables", async () => {
    await migrateAccounts();
    expect(tables(join(process.env.DATA_DIR!, "accounts.sqlite"))).toEqual(expect.arrayContaining(["user", "session", "account", "verification"]));
  });

  test("NOTEFEED_ACCOUNTS_DB moves the file", async () => {
    const path = join(process.env.DATA_DIR!, "elsewhere", "a.sqlite");
    process.env.NOTEFEED_ACCOUNTS_DB = path;
    await migrateAccounts();
    expect(tables(path)).toContain("session");
    expect(existsSync(join(process.env.DATA_DIR!, "accounts.sqlite"))).toBe(false);
  });

  test("the content store holds no Better Auth table", async () => {
    process.env.NOTEFEED_STORAGE = "sqlite";
    await migrateAccounts();
    const { storage } = await import("../storage");
    await storage().listFeeds();
    const content = join(process.env.DATA_DIR!, "notefeed.db");
    expect(tables(content)).not.toContain("session");
    expect(tables(join(process.env.DATA_DIR!, "accounts.sqlite"))).toContain("session");
  });

  test("email sign-up is closed", async () => {
    await migrateAccounts();
    const res = await authRoute(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: { ...H, "content-type": "application/json" },
        body: JSON.stringify({ email: "a@b.example", password: "x".repeat(20), name: "a" }),
      }),
    );
    expect(res.status).toBe(404);
  });

  test("Better Auth answers on its own paths", async () => {
    await migrateAccounts();
    const res = await authRoute(new Request("http://localhost:3000/api/auth/ok", { headers: H }));
    expect(res.status).toBe(200);
  });
});

test("sign-in without PUBLIC_URL refuses to start: Better Auth would trust each request's Host", async () => {
  withProvider();
  delete process.env.PUBLIC_URL;
  await expect(migrateAccounts()).rejects.toThrow(/PUBLIC_URL/);
  expect(accountsAuth()).toBeUndefined();
});
