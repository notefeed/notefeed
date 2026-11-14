// Owners over the API (ADR 0059): a signed-in account (a session from this instance's own pages) creates, claims and manages feeds.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { migrateAccounts } from "../accounts/auth";
import { createAccount, signInWithNumber } from "../accounts/numbers";
import { resetOwnersForTests } from "../feedlock";
import { resetFeedsForTests } from "../feeds";
import { resetRateLimitsForTests } from "../limits";
import { API_PREFIX, dispatch } from "./api";

const BASE = "http://localhost:3000";
const SAME = { host: "localhost:3000", origin: BASE };
beforeEach(async () => {
  vi.stubEnv("NOTEFEED_SECRET", "test-secret-".padEnd(32, "x"));
  vi.stubEnv("NOTEFEED_PASSWORD", "");
  vi.stubEnv("PUBLIC_URL", BASE);
  vi.stubEnv("NOTEFEED_ACCOUNTS", "open");
  resetFeedsForTests();
  resetRateLimitsForTests();
  resetOwnersForTests();
  await migrateAccounts();
});
afterEach(() => vi.unstubAllEnvs());

async function signedIn(): Promise<Record<string, string>> {
  const { number, recoveryKey } = await createAccount();
  const cookies = await signInWithNumber(number, recoveryKey, new Headers(SAME));
  return { ...SAME, cookie: cookies.map((c) => c.split(";")[0]).join("; ") };
}
async function call(method: string, path: string, headers: Record<string, string> = {}, body?: unknown) {
  const url = new URL(API_PREFIX + path, BASE);
  const segments = url.pathname
    .slice(API_PREFIX.length + 1)
    .split("/")
    .map(decodeURIComponent);
  const init: RequestInit = { method, headers: { host: "localhost:3000", ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers } };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  return dispatch(new Request(url, init), segments);
}
const create = (feed: string, headers: Record<string, string>, password?: string) => call("POST", `/feeds/${feed}`, headers, password ? { password } : {});

describe("owning a feed", () => {
  test("a feed created while signed in is the account's, and listed as its own", async () => {
    const ann = await signedIn();
    expect((await create("mine", ann)).status).toBe(201);
    expect(await (await call("GET", "/feeds/mine", ann)).json()).toMatchObject({ owned: true, yours: true });
    expect(await (await call("GET", "/account/feeds", ann)).json()).toEqual({ feeds: ["mine"] });
    expect(await (await call("GET", "/feeds/mine")).json()).toMatchObject({ owned: true, yours: false });
  });

  test("a feed a signed-in account's post makes is its own too; one made without an account is nobody's", async () => {
    const ann = await signedIn();
    expect((await call("POST", "/feeds/posted/notes", { ...ann, "content-type": "text/markdown" }, "# hi")).status).toBe(201);
    expect((await call("POST", "/feeds/anon/notes", { "content-type": "text/markdown" }, "# hi")).status).toBe(201);
    expect(await (await call("GET", "/account/feeds", ann)).json()).toEqual({ feeds: ["posted"] });
    expect(await (await call("GET", "/feeds/anon")).json()).toMatchObject({ owned: false });
  });

  test("the account's feeds need a signed-in account", async () => {
    expect((await call("GET", "/account/feeds")).status).toBe(401);
  });
});

describe("claiming", () => {
  test("a protected feed with its password; then nobody else can, and only the owner deletes it", async () => {
    expect((await create("p", {}, "the-password")).status).toBe(201);
    const ann = await signedIn();
    const bob = await signedIn();
    expect((await call("POST", "/feeds/p/claim", ann, { password: "wrong-password" })).status).toBe(401);
    expect((await call("POST", "/feeds/p/claim", ann, { password: "the-password" })).status).toBe(204);
    const again = await call("POST", "/feeds/p/claim", bob, { password: "the-password" });
    expect(again.status).toBe(409);
    expect((await again.json()).code).toBe("owned");
    const byPassword = await call("DELETE", "/feeds/p", { "x-feed-password": "the-password" });
    expect(byPassword.status).toBe(403);
    expect((await byPassword.json()).code).toBe("owner_only");
    expect((await call("DELETE", "/feeds/p", ann)).status).toBe(204);
  });

  test("needs a signed-in account", async () => {
    await create("p", {}, "the-password");
    expect((await call("POST", "/feeds/p/claim", {}, { password: "the-password" })).status).toBe(401);
  });

  test("a feed password holder may still rename an unowned feed, but not an owned one", async () => {
    await create("p", {}, "the-password");
    const ann = await signedIn();
    await call("POST", "/feeds/p/claim", ann, { password: "the-password" });
    const rename = await call("PUT", "/feeds/p", { "x-feed-password": "the-password" }, { title: "", description: "", name: "q" });
    expect(rename.status).toBe(403);
    expect((await call("PUT", "/feeds/p", ann, { title: "", description: "", name: "q" })).status).toBe(200);
    expect(await (await call("GET", "/account/feeds", ann)).json()).toEqual({ feeds: ["q"] });
  });
});

describe("the owner's feed passwords", () => {
  test("add, list (never the secret), use, revoke", async () => {
    const ann = await signedIn();
    await create("f", ann, "first-password");
    const added = await call("POST", "/feeds/f/passwords", ann, { name: "blog script" });
    expect(added.status).toBe(201);
    const { id, password } = await added.json();
    const list = await (await call("GET", "/feeds/f/passwords", ann)).json();
    expect(list.passwords.map((p: { name: string }) => p.name)).toEqual(["Feed password", "blog script"]);
    expect(JSON.stringify(list)).not.toContain(password);
    const post = () => call("POST", "/feeds/f/notes", { "x-feed-password": password, "content-type": "text/markdown" }, "# from the script");
    expect((await post()).status).toBe(201);
    expect((await call("DELETE", `/feeds/f/passwords/${id}`, ann)).status).toBe(204);
    expect((await post()).status).toBe(401);
    expect((await call("DELETE", "/feeds/f/passwords/nope", ann)).status).toBe(404);
  });

  test("only for the owner: not another account, not a feed password", async () => {
    const ann = await signedIn();
    const bob = await signedIn();
    await create("f", ann, "first-password");
    for (const h of [bob, { "x-feed-password": "first-password" }]) {
      const res = await call("POST", "/feeds/f/passwords", h, { name: "x" });
      expect(res.status).toBe(403);
      expect((await call("GET", "/feeds/f/passwords", h)).status).toBe(403);
    }
  });

  test("a name that isn't one line of 1 to 50 characters is 400", async () => {
    const ann = await signedIn();
    await create("f", ann, "first-password");
    expect((await call("POST", "/feeds/f/passwords", ann, { name: "x".repeat(51) })).status).toBe(400);
    expect((await call("POST", "/feeds/f/passwords", ann, {})).status).toBe(400);
  });
});

test("an account session from another site is no account", async () => {
  const ann = await signedIn();
  await create("mine", ann);
  const evil = { ...ann, origin: "https://evil.example" };
  expect(await (await call("GET", "/feeds/mine", evil)).json()).toMatchObject({ yours: false });
  expect((await call("DELETE", "/feeds/mine", evil)).status).toBe(403);
});

describe("deleting an account", () => {
  test("deletes the feeds it owns first, and leaves everyone else's", async () => {
    const ann = await signedIn();
    await create("annsfeed", ann);
    await create("other", {});
    const res = await (
      await import("./accounts")
    ).accountDeleteRoute(
      new Request(`${BASE}/api/accounts/delete`, {
        method: "POST",
        headers: { ...ann, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ confirm: "x" }),
      }),
    );
    expect(res.headers.get("location")).toBe("/account?error=confirm"); // the number is needed: see accounts.test.ts
    const { deleteAccountWithFeeds } = await import("../posting");
    const { accountOf } = await import("../accounts/numbers");
    await deleteAccountWithFeeds((await accountOf(new Headers(ann)))!.userId);
    expect((await call("GET", "/feeds/annsfeed")).status).toBe(404);
    expect((await call("GET", "/feeds/other")).status).toBe(200);
  });
});

describe("the operator", () => {
  const TOKEN = "t".repeat(40);
  const op = (method: string, query: string, body?: unknown) =>
    import("./operator").then(({ operatorFeedDeleteRoute, operatorFeedOwnerRoute }) =>
      (method === "DELETE" ? operatorFeedDeleteRoute : operatorFeedOwnerRoute)(
        new Request(`${BASE}/api/operator/feeds?${query}`, {
          method,
          headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      ),
    );

  test("gives a feed to an account by its number, or takes its owner away", async () => {
    vi.stubEnv("NOTEFEED_OPERATOR_TOKEN", TOKEN);
    const { number, recoveryKey } = await createAccount();
    const cookies = await signInWithNumber(number, recoveryKey, new Headers(SAME));
    const ann = { ...SAME, cookie: cookies.map((c) => c.split(";")[0]).join("; ") };
    await create("orphan", {}, "the-password");
    expect((await op("PUT", "feed=orphan", { number })).status).toBe(204);
    expect(await (await call("GET", "/account/feeds", ann)).json()).toEqual({ feeds: ["orphan"] });
    expect((await op("PUT", "feed=orphan", { number: null })).status).toBe(204);
    expect(await (await call("GET", "/feeds/orphan", { "x-feed-password": "the-password" })).json()).toMatchObject({ owned: false });
    expect((await op("PUT", "feed=orphan", { number: "1111-2222-3333-4444" })).status).toBe(404);
    expect((await op("PUT", "feed=nope", { number })).status).toBe(404);
  });

  test("deletes a feed, owned or not", async () => {
    vi.stubEnv("NOTEFEED_OPERATOR_TOKEN", TOKEN);
    const ann = await signedIn();
    await create("annsfeed", ann);
    expect((await op("DELETE", "feed=annsfeed")).status).toBe(204);
    expect((await call("GET", "/feeds/annsfeed")).status).toBe(404);
    expect((await op("DELETE", "feed=annsfeed")).status).toBe(404);
  });
});

describe("the owner's sender name", () => {
  const postAs = (feed: string, h: Record<string, string>, extra: Record<string, string> = {}) =>
    call("POST", `/feeds/${feed}/notes`, { ...h, "content-type": "text/markdown", ...extra }, "# a note");
  const senders = async (feed: string, h: Record<string, string>) =>
    ((await (await call("GET", `/feeds/${feed}/notes`, h)).json()).notes as { sender?: string }[]).map((n) => n.sender ?? null);
  const setName = (feed: string, h: Record<string, string>, sender_name: string) =>
    call("PUT", `/feeds/${feed}`, h, { title: "", description: "", sender_name });

  test("follows the owner's own notes: a change changes them all; a sender given with a note stays", async () => {
    const ann = await signedIn();
    await create("f", ann);
    expect((await postAs("f", ann)).status).toBe(201);
    expect((await postAs("f", ann, { "x-note-sender": "Backup bot" })).status).toBe(201);
    expect(await senders("f", ann)).toEqual(["Backup bot", null]); // a number account has no name of its own
    expect((await setName("f", ann, "Ann")).status).toBe(200);
    expect(await senders("f", ann)).toEqual(["Backup bot", "Ann"]);
    expect((await setName("f", ann, "Ann B.")).status).toBe(200);
    expect(await senders("f", ann)).toEqual(["Backup bot", "Ann B."]);
    expect(await (await call("GET", "/feeds/f", ann)).json()).toMatchObject({ sender_name: "Ann B." });
  });

  test("a note posted with a feed password, or by another account, doesn't carry the owner's name", async () => {
    const ann = await signedIn();
    const bob = await signedIn();
    await create("f", ann, "first-password");
    await setName("f", ann, "Ann");
    await postAs("f", { "x-feed-password": "first-password" });
    await postAs("f", { ...bob, "x-feed-password": "first-password" });
    expect(await senders("f", ann)).toEqual([null, null]);
  });

  test("only the owner sets it; on a feed without an owner it can't be set", async () => {
    const ann = await signedIn();
    await create("f", ann, "first-password");
    const byPassword = await setName("f", { "x-feed-password": "first-password" }, "Mallory");
    expect(byPassword.status).toBe(403);
    expect((await byPassword.json()).code).toBe("owner_only");
    await create("free", {});
    expect((await setName("free", {}, "Anyone")).status).toBe(403);
    expect((await setName("free", {}, "")).status).toBe(200); // unchanged is fine
  });

  test("one line of at most 100 characters", async () => {
    const ann = await signedIn();
    await create("f", ann);
    expect((await setName("f", ann, "x".repeat(101))).status).toBe(400);
  });
});
