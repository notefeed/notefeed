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
import { identityOn, providers } from "../oidc/config";
import { secret } from "../secret";
import { processState } from "../state";
import { genericOAuthPlugin } from "./providers";

export const AUTH_PATH = "/api/auth";

function options() {
  const path = config.accountsDb();
  mkdirSync(dirname(path), { recursive: true });
  return {
    database: new Database(path),
    basePath: AUTH_PATH,
    secret: createHmac("sha256", secret()).update("notefeed-better-auth").digest("base64url"),
    ...(config.publicUrl() ? { baseURL: config.publicUrl() } : {}),
    session: { cookieCache: { enabled: true, maxAge: 300 } },
    disabledPaths: ["/sign-up/email", "/sign-in/email", "/sign-in/social"],
    plugins: [genericOAuthPlugin()],
  };
}

const build = () => betterAuth(options());
export type Auth = ReturnType<typeof build>;

const state = processState("accounts-auth", () => ({}) as { key?: string; auth?: Auth });
const key = () => JSON.stringify([config.accountsDb(), config.publicUrl(), providers()]);

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
