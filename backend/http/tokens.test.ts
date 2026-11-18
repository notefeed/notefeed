// Account tokens over the REST API (#390): a script acting as its account.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { migrateAccounts } from "../accounts/auth";
import { createAccount, signInWithNumber } from "../accounts/numbers";
import { resetOwnersForTests } from "../feedlock";
import { resetFeedsForTests } from "../feeds";
import { resetRateLimitsForTests } from "../limits";
import { mcpRoute } from "../mcp";
import { inRequest } from "../requestscope";
import { API_PREFIX, dispatch } from "./api";

const BASE = "http://localhost:3000";
const SAME = { host: "localhost:3000", origin: BASE };
beforeEach(async () => {
  vi.stubEnv("NOTEFEED_SECRET", "test-secret-".padEnd(32, "x"));
  vi.stubEnv("NOTEFEED_PASSWORD", "");
  vi.stubEnv("PUBLIC_URL", BASE);
  vi.stubEnv("NOTEFEED_ACCOUNTS", "closed");
  resetFeedsForTests();
  resetRateLimitsForTests();
  resetOwnersForTests();
  await migrateAccounts();
});
afterEach(() => vi.unstubAllEnvs());

async function session(): Promise<Record<string, string>> {
  const { number, recoveryKey } = await createAccount();
  const cookies = await signInWithNumber(number, recoveryKey, new Headers(SAME));
  return { ...SAME, cookie: cookies.map((c) => c.split(";")[0]).join("; ") };
}
function call(method: string, path: string, headers: Record<string, string> = {}, body?: unknown) {
  const url = new URL(API_PREFIX + path, BASE);
  const segments = url.pathname
    .slice(API_PREFIX.length + 1)
    .split("/")
    .map(decodeURIComponent);
  const json = body !== undefined && typeof body !== "string";
  const init: RequestInit = { method, headers: { host: "localhost:3000", ...(json ? { "content-type": "application/json" } : {}), ...headers } };
  if (body !== undefined) init.body = json ? JSON.stringify(body) : (body as string);
  return inRequest({ id: "t" }, () => dispatch(new Request(url, init), segments));
}
async function token(h: Record<string, string>, scope = "read+write") {
  const res = await call("POST", "/account/tokens", h, { name: "script", scope });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; token: string };
}
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

test("on a locked instance a token gets in, acts as its account: creates, posts to and lists its feeds", async () => {
  const ann = await session();
  const { token: t } = await token(ann);
  expect((await call("POST", "/feeds/scripted", bearer(t), {})).status).toBe(201);
  expect((await call("POST", "/feeds/scripted/notes", { ...bearer(t), "content-type": "text/markdown" }, "# from a script")).status).toBe(201);
  expect(await (await call("GET", "/account/feeds", bearer(t))).json()).toEqual({ feeds: ["scripted"] });
  expect(await (await call("GET", "/feeds/scripted", ann)).json()).toMatchObject({ yours: true });
});

test("a read token reads but doesn't write (403 read_only)", async () => {
  const ann = await session();
  await call("POST", "/feeds/mine", ann, {});
  const { token: t } = await token(ann, "read");
  expect((await call("GET", "/account/feeds", bearer(t))).status).toBe(200);
  const res = await call("POST", "/feeds/mine/notes", { ...bearer(t), "content-type": "text/markdown" }, "# no");
  expect(res.status).toBe(403);
  expect((await res.json()).code).toBe("read_only");
});

test("a revoked or unknown token is 401; tokens are listed without their secret, and only the session makes or lists them", async () => {
  const ann = await session();
  const { id, token: t } = await token(ann);
  const list = await (await call("GET", "/account/tokens", ann)).json();
  expect(list.tokens).toEqual([expect.objectContaining({ id, name: "script", scope: "read+write" })]);
  expect(JSON.stringify(list)).not.toContain(t);
  expect((await call("GET", "/account/tokens", bearer(t))).status).toBe(401);
  expect((await call("POST", "/account/tokens", bearer(t), { name: "x" })).status).toBe(401);
  expect((await call("DELETE", `/account/tokens/${id}`, ann)).status).toBe(204);
  expect((await call("GET", "/account/feeds", bearer(t))).status).toBe(401);
  expect((await call("GET", "/account/feeds", bearer("nf_nonsense"))).status).toBe(401);
});

test("a token is refused on MCP", async () => {
  const ann = await session();
  const { token: t } = await token(ann);
  const res = await mcpRoute(
    new Request(`${BASE}/mcp`, {
      method: "POST",
      headers: { ...bearer(t), "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }),
  );
  expect(res.status).toBe(401);
});

test("a read token is refused where no method was noted (a form route outside the REST dispatcher): it counts as a write", async () => {
  const ann = await session();
  const { token: t } = await token(ann, "read");
  const { requestAccount } = await import("./request");
  const { ReadOnlyTokenError } = await import("../errors");
  await expect(inRequest({ id: "f" }, () => requestAccount(new Headers({ ...SAME, ...bearer(t) })))).rejects.toBeInstanceOf(ReadOnlyTokenError);
});
