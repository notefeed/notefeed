// Better Auth (conventions: Sign-in, Better Auth) on a SQLite file of its own, DATA_DIR/accounts.sqlite (NOTEFEED_ACCOUNTS_DB), apart
// from the content store on every backend: sessions and tokens never sit next to notes (ADR 0055). Built only while sign-in is
// configured; one instance per process, rebuilt when the file or the providers change (tests switch both).
// Stricter than Better Auth's defaults: no e-mail sign-up or sign-in, no social sign-in, telemetry never turned on, the secret
// derived from notefeed's own.
import Database from "better-sqlite3";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";
import { getMigrations } from "better-auth/db/migration";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config";
import { logger } from "../log";
import { key as signingKey, TTL } from "../oauth/tokens";
import { allowed, providerById, providers } from "../oidc/config";
import { accountsMode, accountsOn } from "./mode";
import { logFailure } from "../oidc/log";
import { clientIp, rateLimit } from "../limits";
import { cleanLine } from "../../shared/links";
import { processState } from "../state";
import { genericOAuthPlugin, senderName } from "./providers";

export const AUTH_PATH = "/api/auth";
const betterAuthLog = logger("better-auth");
const betterAuthSecret = () => createHmac("sha256", signingKey()).update("notefeed-better-auth").digest("base64url");
const NO_TOKENS = { accessToken: null, refreshToken: null, idToken: null };

function options() {
  const path = config.accountsDb();
  mkdirSync(dirname(path), { recursive: true });
  return {
    database: new Database(path),
    basePath: AUTH_PATH,
    // From the key of the other signed values (oauth/tokens.ts: the server secret and the instance password), so changing either
    // signs everyone out.
    secret: betterAuthSecret(),
    // Always PUBLIC_URL (migrateAccounts refuses to start without it): from a request's Host, Better Auth's origin check would trust
    // whatever host a request names.
    baseURL: config.publicUrl(),
    // Never the client's address (V2): Better Auth would write it, and the user agent, on every session.
    advanced: { ipAddress: { disableIpTracking: true } },
    // Two providers that report the same e-mail stay two people: one never signs in as the other.
    account: { accountLinking: { enabled: false } },
    // A sign-in renews while used (at most once a day) and ends after 30 days unused; signedInSession ends it sooner: 90 days after it
    // was made, or as soon as the allow-list no longer lets the person in (ADR 0056).
    session: { expiresIn: TTL.idle, updateAge: TTL.renew, cookieCache: { enabled: true, maxAge: 300 } },
    // Better Auth keeps the provider's tokens with the account. notefeed never uses them, and the id_token holds the person's
    // claims: none of them is stored.
    databaseHooks: {
      account: {
        create: { before: async (account: Record<string, unknown>) => ({ data: { ...account, ...NO_TOKENS } }) },
        update: { before: async (account: Record<string, unknown>) => ({ data: { ...account, ...NO_TOKENS } }) },
      },
      session: { create: { before: async (session: Record<string, unknown>) => ({ data: { ...session, ipAddress: null, userAgent: null } }) } },
    },
    // Better Auth's routes over HTTP are only those a sign-in passes through (authRoute); notefeed calls the rest on the server.
    // Better Auth's own lines (a discovery that failed, a code the provider refused) go to notefeed's log, component `better-auth`.
    logger: { level: "warn" as const, log: (level: "debug" | "info" | "warn" | "error", message: string) => betterAuthLog[level]({}, message) },
    // Account numbers (ADR 0057): the username is the number, the password the recovery key. Accounts are made only by notefeed's
    // own createAccount (numbers.ts) on the server: the e-mail routes are outside authRoute's allow-list.
    emailAndPassword: { enabled: true, minPasswordLength: 20, maxPasswordLength: 64, autoSignIn: false },
    plugins: [
      genericOAuthPlugin(),
      username({ minUsernameLength: 16, maxUsernameLength: 16, usernameValidator: (u: string) => /^[1-9]\d{15}$/.test(u), displayUsername: false }),
      passkey({ rpID: new URL(config.publicUrl()).hostname, rpName: "notefeed" }),
    ],
  };
}

const build = () => betterAuth(options());
export type Auth = ReturnType<typeof build>;

const state = processState("accounts-auth", () => ({}) as { key?: string; auth?: Auth });
// Everything the instance is built from, so a changed setting (or secret) builds it again.
const key = () => JSON.stringify([config.accountsDb(), config.publicUrl(), betterAuthSecret(), accountsMode(), providers()]);

// The instance, or undefined while accounts are off (or PUBLIC_URL is missing, which startup refuses).
export function accountsAuth(): Auth | undefined {
  if (!accountsOn() || !config.publicUrl()) return undefined;
  const k = key();
  if (state.key !== k || !state.auth) {
    state.auth = build();
    state.key = k;
  }
  return state.auth;
}

// Creates or updates Better Auth's tables; nothing while accounts are off (no file is made). The settings were checked at start-up
// (mode.ts, checkAccessSettings).
export async function migrateAccounts(): Promise<void> {
  const auth = accountsAuth();
  if (!auth) return;
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
}

// What a browser may reach of Better Auth: a provider's return (/callback/<provider>), its error and health pages, and passkeys. Everything else
// (update-user, which would change the sender; account linking; sign-in with a bare id_token, which skips /api/oidc/start's checks;
// session lists) is 404: notefeed calls what it needs on the server (auth.api).
// Passkeys (ADR 0057) are Better Auth's own: adding one needs the session, signing in with one makes it; the browser talks to them
// directly (WebAuthn).
const OPEN =
  /^\/api\/auth\/(callback\/[a-z0-9_]{1,64}|error|ok|passkey\/(generate-register-options|verify-registration|generate-authenticate-options|verify-authentication|list-user-passkeys|delete-passkey))$/;

// Passkey steps anyone may start, without a session: each writes a challenge to accounts.sqlite, so they count toward the posts limit
// (Better Auth's own limiter is off: it would need the client's address, which notefeed never gives it).
const ANONYMOUS = /\/passkey\/(generate-authenticate-options|verify-authentication)$/;

// GET and POST /api/auth/*: 404 while sign-in is off.
export async function authRoute(req: Request): Promise<Response> {
  const auth = accountsAuth();
  const path = new URL(req.url).pathname;
  if (!auth || !OPEN.test(path)) return new Response("not found", { status: 404 });
  if (ANONYMOUS.test(path)) {
    const wait = rateLimit(clientIp(req.headers));
    if (wait !== null) return Response.json({ error: "rate limit exceeded" }, { status: 429, headers: { "Retry-After": String(wait) } });
  }
  // A passkey's name is its holder's, shown on the account page: one line, at most 50 characters (cleanLine's rules, as a note title).
  if (path.endsWith("/passkey/verify-registration")) {
    const body = (await req
      .clone()
      .json()
      .catch(() => ({}))) as { name?: unknown };
    const name = body?.name;
    if (name !== undefined && (typeof name !== "string" || cleanLine(name) !== name || [...name].length > 50))
      return Response.json({ error: "a passkey's name is one line of at most 50 characters" }, { status: 400 });
  }
  // Removing a passkey changes how the account is reached: like a new recovery key, it needs a sign-in from the last day.
  if (path.endsWith("/passkey/delete-passkey")) {
    const session = await signedInSession(req.headers);
    if (session && !fresh(session)) return Response.json({ error: "sign in again" }, { status: 403 });
  }
  return auth.handler(req);
}

// Why the person behind `userId` may no longer be signed in, or null while they may: their provider is still configured and its
// allow-list still lets in the address (and verified flag) it gave at sign-in. A placeholder address (no email claim) is none.
async function refusal(auth: Auth, userId: string): Promise<{ reason: string; provider?: string } | null> {
  const ctx = await auth.$context;
  const [user, accounts] = await Promise.all([ctx.internalAdapter.findUserById(userId), ctx.internalAdapter.findAccounts(userId)]);
  if (!user) return { reason: "person no longer known" };
  // A number account (its credential is the recovery key) answers to no provider's allow-list; with `provider` there are none.
  if (accounts.some((a) => a.providerId === "credential")) return accountsMode() === "provider" ? { reason: "number accounts are off (provider mode)" } : null;
  const id = accounts[0]?.providerId;
  const p = id ? providerById(id) : undefined;
  if (!p) return { reason: "provider no longer configured", ...(id && /^[a-z0-9_]{1,64}$/.test(id) ? { provider: id } : {}) };
  const email = user.email.endsWith(".oidc.invalid") ? undefined : user.email;
  return allowed(p, { email, email_verified: user.emailVerified }) ? null : { reason: "person no longer on the allow-list", provider: p.id };
}

// Whether the person may still be signed in (for an MCP client's refresh, oauth/routes.ts); false while sign-in is off.
export async function stillAllowed(userId: string): Promise<boolean> {
  const auth = accountsAuth();
  return auth ? (await refusal(auth, userId)) === null : false;
}

// `name`: the sender name from an identity provider; a number account has none. `token`: the session's own, `createdAt`: when it
// was signed in (ms), for the steps that need a recent sign-in (`fresh`).
export type SignedIn = { userId: string; name?: string; token: string; createdAt: number; setCookies: string[] };

// Signed in within the last day: what changing how the account is reached needs (a new recovery key, removing a passkey, deleting
// it), so a stolen session cookie alone can't lock the holder out. Better Auth asks the same for adding a passkey.
export const fresh = (s: Pick<SignedIn, "createdAt">): boolean => Date.now() - s.createdAt < TTL.renew * 1000;

// The signed-in person from Better Auth's session cookie in `h`; undefined without a valid session or while sign-in is off. Only
// with `renew` (the proxy, which hands the cookies to the browser with the page) is a session due for it renewed and its cookies
// returned: a renewal anywhere else would move the session's end in the file but not the browser's cookie. A session older than
// 90 days, or whose person the allow-list no longer lets in, is deleted here and logged once with the provider and the reason,
// never who. Which requests may use it (same origin, no Authorization header) is the caller's rule.
export async function signedInSession(h: Headers, { renew = false }: { renew?: boolean } = {}): Promise<SignedIn | undefined> {
  const auth = accountsAuth();
  if (!auth) return undefined;
  const query = renew ? {} : { disableRefresh: true };
  const got = await auth.api.getSession({ headers: h, query, returnHeaders: true }).catch(() => null);
  const session = got?.response;
  if (!session) return undefined;
  // The row itself, also behind the 5-minute cookie cache: a session ended (logged out, a new recovery key, the account deleted) is
  // over at once, and its sign-in time is the file's.
  const { adapter, internalAdapter } = await auth.$context;
  const token = session.session.token;
  const row = await adapter.findOne<{ createdAt: Date | string }>({ model: "session", where: [{ field: "token", value: token }] });
  if (!row) return undefined;
  const createdAt = new Date(row.createdAt).getTime();
  const tooOld = Date.now() - createdAt > TTL.signInMax * 1000;
  const refused = tooOld ? { reason: "sign-in older than 90 days" } : await refusal(auth, session.user.id);
  const name = senderName(session.user.name);
  if (refused) {
    // Ended and logged once: the row is gone after this, so the cookie cache can't bring it back.
    await internalAdapter.deleteSession(token);
    const { reason, ...detail } = refused;
    logFailure(reason, detail);
    return undefined;
  }
  return {
    userId: session.user.id,
    ...(name ? { name } : {}),
    token,
    createdAt,
    setCookies: renew ? got.headers.getSetCookie() : [],
  };
}

// The sender name an account has from its identity provider, or undefined (a number account, a gone one, accounts off).
export async function accountName(userId: string): Promise<string | undefined> {
  const auth = accountsAuth();
  if (!auth) return undefined;
  return senderName((await (await auth.$context).internalAdapter.findUserById(userId))?.name);
}

// The signed-in person's name (the sender); see signedInSession.
export const signedInName = async (h: Headers): Promise<string | undefined> => (await signedInSession(h))?.name;
