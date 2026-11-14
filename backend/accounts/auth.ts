// Better Auth (conventions: Sign-in, Better Auth) on a SQLite file of its own, DATA_DIR/accounts.sqlite (NOTEFEED_ACCOUNTS_DB), apart
// from the content store on every backend: sessions and tokens never sit next to notes (ADR 0055). Built only while sign-in is
// configured; one instance per process, rebuilt when the file or the providers change (tests switch both).
// Stricter than Better Auth's defaults: no e-mail sign-up or sign-in, no social sign-in, telemetry never turned on, the secret
// derived from notefeed's own.
import Database from "better-sqlite3";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { createHash, createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config";
import { logger } from "../log";
import { identityOn, providers } from "../oidc/config";
import { secret } from "../secret";
import { processState } from "../state";
import { genericOAuthPlugin } from "./providers";

export const AUTH_PATH = "/api/auth";
const betterAuthLog = logger("better-auth");
const NO_TOKENS = { accessToken: null, refreshToken: null, idToken: null };

function options() {
  const path = config.accountsDb();
  mkdirSync(dirname(path), { recursive: true });
  return {
    database: new Database(path),
    basePath: AUTH_PATH,
    // From the server secret and the instance password, like the other signed values (oauth/tokens.ts): changing either signs
    // everyone out.
    secret: createHmac("sha256", secret()).update("notefeed-better-auth\0").update(createHash("sha256").update(config.password()).digest()).digest("base64url"),
    ...(config.publicUrl() ? { baseURL: config.publicUrl() } : {}),
    // A sign-in lasts 7 days from the moment it was made, as before: use doesn't extend it, so taking someone off the allow-list
    // ends their access within that time.
    session: { expiresIn: 604_800, disableSessionRefresh: true, cookieCache: { enabled: true, maxAge: 300 } },
    // Better Auth keeps the provider's tokens with the account. notefeed never uses them, and the id_token holds the person's
    // claims: none of them is stored.
    databaseHooks: {
      account: {
        create: { before: async (account: Record<string, unknown>) => ({ data: { ...account, ...NO_TOKENS } }) },
        update: { before: async (account: Record<string, unknown>) => ({ data: { ...account, ...NO_TOKENS } }) },
      },
    },
    // The providers are Better Auth "social" providers (genericOAuth), so /sign-in/social stays; no built-in ones are configured.
    disabledPaths: ["/sign-up/email", "/sign-in/email"],
    // Better Auth's own lines (a discovery that failed, a code the provider refused) go to notefeed's log, component `better-auth`.
    logger: { level: "warn" as const, log: (level: "debug" | "info" | "warn" | "error", message: string) => betterAuthLog[level]({}, message) },
    plugins: [genericOAuthPlugin()],
  };
}

const build = () => betterAuth(options());
export type Auth = ReturnType<typeof build>;

const state = processState("accounts-auth", () => ({}) as { key?: string; auth?: Auth });
const key = () => JSON.stringify([config.accountsDb(), config.publicUrl(), createHash("sha256").update(config.password()).digest("hex"), providers()]);

// The instance, or undefined while no sign-in provider is configured.
export function accountsAuth(): Auth | undefined {
  if (!identityOn()) return undefined;
  const k = key();
  if (state.key !== k || !state.auth) {
    state.auth = build();
    state.key = k;
  }
  return state.auth;
}

// Creates or updates Better Auth's tables; nothing while sign-in is off (no file is made).
export async function migrateAccounts(): Promise<void> {
  const auth = accountsAuth();
  if (!auth) return;
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
}

// GET and POST /api/auth/*: Better Auth's own routes, 404 while sign-in is off.
export async function authRoute(req: Request): Promise<Response> {
  const auth = accountsAuth();
  if (!auth) return new Response("not found", { status: 404 });
  return auth.handler(req);
}

// The signed-in person's name (the sender), from Better Auth's session cookie in `h`; undefined without a valid session or while
// sign-in is off. Which requests may use it (same origin, no Authorization header) is the caller's rule.
export async function signedInName(h: Headers): Promise<string | undefined> {
  const auth = accountsAuth();
  if (!auth) return undefined;
  const session = await auth.api.getSession({ headers: h }).catch(() => null);
  return session?.user.name || undefined;
}
