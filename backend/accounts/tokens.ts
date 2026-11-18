// Account tokens (#390, ADR 0060): for a script that acts as the whole account over the REST API (list and create its feeds, post to and
// manage the ones it owns, as the owner would). Better Auth's api-key plugin keeps them in accounts.sqlite, hashed; shown once at
// creation. Each has a name, a scope (`read` or `read+write`) and an end, 90 days unless said otherwise. REST only: the MCP endpoint
// and the browser's session never take one (conventions: tokens bound to one surface).
import { cleanLine } from "../../shared/links";
import { InvalidBodyError, NotFoundError } from "../errors";
import { accountsAuth, stillAllowed } from "./auth";

export const TOKEN_PREFIX = "nf_";
export const TOKEN_SCOPES = ["read", "read+write"] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];
export const DEFAULT_TOKEN_DAYS = 90;
const MAX_DAYS = 365;
const DAY = 86_400;

export type AccountToken = { id: string; name: string; scope: TokenScope; expiresAt: string | null; lastUsed: string | null };

function auth() {
  const a = accountsAuth();
  if (!a) throw new NotFoundError("accounts are off");
  return a;
}

const scopeOf = (permissions: unknown): TokenScope => {
  const p = (typeof permissions === "string" ? JSON.parse(permissions) : permissions) as { feeds?: string[] } | null;
  return p?.feeds?.includes("write") ? "read+write" : "read";
};
const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

export async function createAccountToken(
  userId: string,
  name: string,
  scope: TokenScope,
  days = DEFAULT_TOKEN_DAYS,
): Promise<AccountToken & { token: string }> {
  const clean = cleanLine(name);
  if (!clean || clean !== name.trim() || [...clean].length > 50) throw new InvalidBodyError("name must be one line of 1 to 50 characters");
  if (!(TOKEN_SCOPES as readonly string[]).includes(scope)) throw new InvalidBodyError("scope must be read or read+write");
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) throw new InvalidBodyError(`days must be a whole number from 1 to ${MAX_DAYS}`);
  const made = await auth().api.createApiKey({
    body: { userId, name: clean, expiresIn: days * DAY, permissions: { feeds: scope === "read" ? ["read"] : ["read", "write"] } },
  });
  return { id: made.id, name: clean, scope, expiresAt: iso(made.expiresAt), lastUsed: null, token: made.key };
}

type Row = { id: string; name: string | null; permissions: unknown; expiresAt: unknown; lastRequest: unknown; referenceId: string };
const rows = async (userId: string) =>
  (await (await auth().$context).adapter.findMany<Row>({ model: "apikey", where: [{ field: "referenceId", value: userId }] })) ?? [];

export const listAccountTokens = async (userId: string): Promise<AccountToken[]> =>
  (await rows(userId)).map((r) => ({ id: r.id, name: r.name ?? "", scope: scopeOf(r.permissions), expiresAt: iso(r.expiresAt), lastUsed: iso(r.lastRequest) }));

export async function revokeAccountToken(userId: string, id: string): Promise<void> {
  if (!(await rows(userId)).some((r) => r.id === id)) throw new NotFoundError("no such token");
  await (await auth().$context).adapter.delete({ model: "apikey", where: [{ field: "id", value: id }] });
}

// The account a token belongs to, and whether it may write; undefined for anything that isn't a valid token of an account that may
// still be signed in.
export async function tokenAccount(token: string): Promise<{ userId: string; write: boolean } | undefined> {
  const a = accountsAuth();
  if (!a || !token.startsWith(TOKEN_PREFIX)) return undefined;
  const r = await a.api.verifyApiKey({ body: { key: token } }).catch(() => null);
  if (!r?.valid || !r.key) return undefined;
  const userId = (r.key as { referenceId?: string; userId?: string }).referenceId ?? (r.key as { userId?: string }).userId;
  // As a session is checked (ADR 0056): the account must still exist and, signed in through a provider, still be on its allow-list.
  if (!userId || !(await stillAllowed(userId))) return undefined;
  return { userId, write: scopeOf(r.key.permissions) === "read+write" };
}
