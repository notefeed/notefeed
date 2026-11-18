// MCP as an account (#390, ADR 0062): a client signed in with an account, through Better Auth's OAuth server, acts as it; its feeds,
// claiming, feed passwords and tokens.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { migrateAccounts } from "./accounts/auth";
import { createAccount } from "./accounts/numbers";
import { resetOwnersForTests } from "./feedlock";
import { resetFeedsForTests } from "./feeds";
import { resetRateLimitsForTests } from "./limits";
import { readFileSync } from "node:fs";
import { ACCOUNT_TOOLS, mcpRoute } from "./mcp";
import { mcpToken } from "./accounts/mcp.testkit";

const BASE = "http://localhost:3000";
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

const V = "2026-07-28";
const tokens: Record<string, string> = {};
const META = {
  "io.modelcontextprotocol/clientInfo": { name: "t", version: "0" },
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/protocolVersion": V,
};
async function send(tool: string, args: Record<string, unknown>, uid?: string) {
  const headers: Record<string, string> = {
    host: "localhost:3000",
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": V,
    "mcp-method": "tools/call",
    "mcp-name": tool,
  };
  if (uid) headers.authorization = `Bearer ${(tokens[uid] ??= await mcpToken(uid))}`;
  const body = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args, _meta: META } };
  return mcpRoute(new Request(`${BASE}/mcp`, { method: "POST", headers, body: JSON.stringify(body) }));
}
async function call(tool: string, args: Record<string, unknown>, uid?: string) {
  const res = await send(tool, args, uid);
  return (await res.json()).result as { isError?: boolean; structuredContent: Record<string, unknown>; content: { text: string }[] };
}

test("a client signed in as an account creates its own feed, lists it, gives it a password and revokes it", async () => {
  const { userId } = await createAccount();
  expect((await call("create_feed", { feed: "mine" }, userId)).isError).toBeFalsy();
  expect((await call("list_feeds", {}, userId)).structuredContent.feeds).toEqual(["mine"]);
  const added = await call("add_feed_password", { feed: "mine", name: "blog script" }, userId);
  expect(added.structuredContent.password).toMatch(/^[A-Za-z0-9_-]{24}$/);
  expect(added.structuredContent.guidance).toEqual(expect.arrayContaining([expect.stringContaining("only time")]));
  const list = await call("list_feed_passwords", { feed: "mine" }, userId);
  expect((list.structuredContent.passwords as { name: string }[]).map((p) => p.name)).toEqual(["blog script"]);
  expect((await call("revoke_feed_password", { feed: "mine", id: added.structuredContent.id }, userId)).isError).toBeFalsy();
});

test("a note the owner's client posts carries the owner's mark", async () => {
  const { userId } = await createAccount();
  await call("create_feed", { feed: "mine" }, userId);
  await call("update_feed", { feed: "mine", title: "", description: "", sender_name: "Ann" }, userId);
  await call("post_note", { feed: "mine", markdown: "# hi" }, userId);
  const notes = (await call("list_notes", { feed: "mine" }, userId)).structuredContent.notes as { sender?: string }[];
  expect(notes[0].sender).toBe("Ann");
});

test("claiming a protected feed; another account can't then", async () => {
  const a = await createAccount();
  const b = await createAccount();
  await call("create_feed", { feed: "p", password: "the-password" });
  expect((await call("claim_feed", { feed: "p", password: "the-password" }, a.userId)).isError).toBeFalsy();
  expect((await call("claim_feed", { feed: "p", password: "the-password" }, b.userId)).isError).toBe(true);
});

test("account tokens through MCP: made (shown once), listed, revoked", async () => {
  const { userId } = await createAccount();
  const made = await call("create_account_token", { name: "backup", scope: "read" }, userId);
  expect(made.structuredContent.token).toMatch(/^nf_/);
  const listed = await call("list_account_tokens", {}, userId);
  expect(listed.structuredContent.tokens).toEqual([expect.objectContaining({ name: "backup", scope: "read" })]);
  expect((await call("revoke_account_token", { id: made.structuredContent.id }, userId)).isError).toBeFalsy();
});

// A client without a sign-in is let in as no one, so open feeds work without an account (V12); an account tool answers it with the sign-in
// challenge (401 with the resource metadata), which is what makes an MCP client open the authorize page.
const CHALLENGE = `Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`;
test.each([
  ["list_feeds", {}],
  ["get_license", {}],
  ["create_account_token", { name: "x" }],
  ["update_feed", { feed: "open", licensed: true }],
  ["update_feed", { feed: "open", sender_name: "Ann" }],
])("without a sign-in, %s %j asks the client to sign in", async (tool, args) => {
  const res = await send(tool, args);
  expect(res.status).toBe(401);
  expect(res.headers.get("www-authenticate")).toBe(CHALLENGE);
});

test("without a sign-in, the open tools work as before: a feed, a note, its title", async () => {
  expect((await call("post_note", { feed: "open", markdown: "# hi" })).isError).toBeFalsy();
  expect((await call("update_feed", { feed: "open", title: "Open" })).isError).toBeFalsy();
  expect((await call("list_notes", { feed: "open" })).structuredContent.notes).toHaveLength(1);
});

test("signed in, an account tool runs", async () => {
  const { userId } = await createAccount();
  expect((await send("list_feeds", {}, userId)).status).toBe(200);
});

// The list the sign-in challenge reads is the list of tools that need an account: every tool whose handler calls needAccount().
test("ACCOUNT_TOOLS names exactly the tools that call needAccount()", () => {
  const source = readFileSync("backend/mcp.ts", "utf8");
  const blocks = source.split("s.registerTool(").slice(1);
  const needing = blocks.filter((b) => b.includes("needAccount()")).map((b) => /^\s*"([a-z_]+)"/.exec(b)![1]);
  expect(needing.sort()).toEqual([...ACCOUNT_TOOLS].sort());
});
