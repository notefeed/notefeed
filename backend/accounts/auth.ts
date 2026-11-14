// Better Auth (conventions: Sign-in, Better Auth) on a SQLite file of its own, DATA_DIR/accounts.sqlite (NOTEFEED_ACCOUNTS_DB), apart
// from the content store on every backend: sessions and tokens never sit next to notes (ADR 0055). Built only while sign-in is
// configured; one instance per process, rebuilt when the file or the providers change (tests switch both).
// Stricter than Better Auth's defaults: no e-mail sign-up or sign-in, no social sign-in, telemetry never turned on, the secret
// derived from notefeed's own.
import Database from "better-sqlite3";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config";
import { logger } from "../log";
import { key as signingKey, TTL } from "../oauth/tokens";
import { allowed, identityOn, providerById, providers } from "../oidc/config";
import { logFailure } from "../oidc/log";
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
    plugins: [genericOAuthPlugin()],
  };
}

const build = () => betterAuth(options());
export type Auth = ReturnType<typeof build>;

const state = processState("accounts-auth", () => ({}) as { key?: string; auth?: Auth });
// Everything the instance is built from, so a changed setting (or secret) builds it again.
const key = () => JSON.stringify([config.accountsDb(), config.publicUrl(), betterAuthSecret(), providers()]);

// The instance, or undefined while no sign-in provider is configured (or PUBLIC_URL is missing, which startup refuses).
export function accountsAuth(): Auth | undefined {
  if (!identityOn() || !config.publicUrl()) return undefined;
  const k = key();
  if (state.key !== k || !state.auth) {
    state.auth = build();
    state.key = k;
  }
  return state.auth;
}

// Creates or updates Better Auth's tables; nothing while sign-in is off (no file is made).
export async function migrateAccounts(): Promise<void> {
  if (identityOn() && !config.publicUrl()) throw new Error("sign-in (NOTEFEED_OIDC_*) needs PUBLIC_URL, the address people reach notefeed at");
  const auth = accountsAuth();
  if (!auth) return;
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
}

// What a browser may reach of Better Auth: a provider's return (/callback/<provider>) and its error and health pages. Everything else
// (update-user, which would change the sender; account linking; sign-in with a bare id_token, which skips /api/oidc/start's checks;
// session lists) is 404: notefeed calls what it needs on the server (auth.api).
const OPEN = /^\/api\/auth\/(callback\/[a-z0-9_]{1,64}|error|ok)$/;

// GET and POST /api/auth/*: 404 while sign-in is off.
export async function authRoute(req: Request): Promise<Response> {
  const auth = accountsAuth();
  if (!auth || !OPEN.test(new URL(req.url).pathname)) return new Response("not found", { status: 404 });
  return auth.handler(req);
}

// Why the person behind `userId` may no longer be signed in, or null while they may: their provider is still configured and its
// allow-list still lets in the address (and verified flag) it gave at sign-in. A placeholder address (no email claim) is none.
async function refusal(auth: Auth, userId: string): Promise<{ reason: string; provider?: string } | null> {
  const ctx = await auth.$context;
  const [user, accounts] = await Promise.all([ctx.internalAdapter.findUserById(userId), ctx.internalAdapter.findAccounts(userId)]);
  const id = accounts[0]?.providerId;
  const p = id ? providerById(id) : undefined;
  if (!user || !p) return { reason: "provider no longer configured", ...(id && /^[a-z0-9_]{1,64}$/.test(id) ? { provider: id } : {}) };
  const email = user.email.endsWith(".oidc.invalid") ? undefined : user.email;
  return allowed(p, { email, email_verified: user.emailVerified }) ? null : { reason: "person no longer on the allow-list", provider: p.id };
}

// Whether the person may still be signed in (for an MCP client's refresh, oauth/routes.ts); false while sign-in is off.
export async function stillAllowed(userId: string): Promise<boolean> {
  const auth = accountsAuth();
  return auth ? (await refusal(auth, userId)) === null : false;
}

export type SignedIn = { userId: string; name: string; setCookies: string[] };

// The signed-in person from Better Auth's session cookie in `h`, with the cookies that renew it (the proxy passes them on); undefined
// without a valid session or while sign-in is off. A session older than 90 days, or whose person the allow-list no longer lets in,
// is deleted here and logged with the provider and the reason, never who. Which requests may use it (same origin, no
// Authorization header) is the caller's rule.
export async function signedInSession(h: Headers): Promise<SignedIn | undefined> {
  const auth = accountsAuth();
  if (!auth) return undefined;
  const got = await auth.api.getSession({ headers: h, returnHeaders: true }).catch(() => null);
  const session = got?.response;
  if (!session) return undefined;
  const tooOld = Date.now() - new Date(session.session.createdAt).getTime() > TTL.signInMax * 1000;
  const refused = tooOld ? { reason: "sign-in older than 90 days" } : await refusal(auth, session.user.id);
  const name = senderName(session.user.name);
  if (refused || !name) {
    await (await auth.$context).internalAdapter.deleteSession(session.session.token);
    const { reason, ...detail } = refused ?? { reason: "no sender name" };
    logFailure(reason, detail);
    return undefined;
  }
  return { userId: session.user.id, name, setCookies: got.headers.getSetCookie() };
}

// The signed-in person's name (the sender); see signedInSession.
export const signedInName = async (h: Headers): Promise<string | undefined> => (await signedInSession(h))?.name;
