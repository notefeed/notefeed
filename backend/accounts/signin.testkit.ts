// Tests only: a signed-in person without running a provider. Turns sign-in on with a provider that is never contacted, creates a
// Better Auth user and session through its server side, and returns the signed session cookie a browser would send
// (conventions: Better Auth, Tests). Nothing here is reachable from the app.
import { makeSignature } from "better-auth/crypto";
import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import { accountsAuth, migrateAccounts } from "./auth";

export function stubSignInOn(): void {
  if (!process.env.NOTEFEED_SECRET) vi.stubEnv("NOTEFEED_SECRET", "a".repeat(40));
  if (!process.env.PUBLIC_URL) vi.stubEnv("PUBLIC_URL", "http://localhost:3000");
  vi.stubEnv("NOTEFEED_OIDC_ISSUER", "https://idp.example");
  vi.stubEnv("NOTEFEED_OIDC_CLIENT_ID", "id");
  vi.stubEnv("NOTEFEED_OIDC_CLIENT_SECRET", "secret");
  vi.stubEnv("NOTEFEED_OIDC_ALLOW", "*");
}

// `name=value` of the Better Auth session cookie of a new person called `name`.
export async function signedInCookie(name = "Ann", expiresAt?: Date): Promise<string> {
  await migrateAccounts();
  const auth = accountsAuth();
  if (!auth) throw new Error("sign-in is off: call stubSignInOn() first");
  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser({ email: `${randomUUID()}@test.invalid`, name, emailVerified: true }, { method: "test" } as never);
  const session = await ctx.internalAdapter.createSession(user.id, false, expiresAt ? { expiresAt } : undefined, true);
  return `${ctx.authCookies.sessionToken.name}=${session.token}.${await makeSignature(session.token, ctx.secret)}`;
}
