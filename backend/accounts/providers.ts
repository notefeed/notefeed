// The operator's OIDC providers (backend/oidc/config.ts) as Better Auth's generic OAuth providers, one per NOTEFEED_OIDC_* set.
// Better Auth does discovery, the authorization code flow with PKCE and state, and checks the id_token against the provider's
// keys and the nonce. What is notefeed's stays here: the allow-list and which claim becomes the sender, read from the id_token's
// claims as before (ADR 0014). A refusal is logged with its reason (oidc/log.ts) and ends the sign-in: getUserInfo answers null,
// which Better Auth turns into a redirect to the error page notefeed gave it.
import type { GenericOAuthConfig } from "better-auth/plugins";
import { genericOAuth } from "better-auth/plugins";
import { decodeJwt } from "jose";
import { allowed, type Provider, providers, senderFrom } from "../oidc/config";
import { logFailure } from "../oidc/log";
import { cleanLine } from "../../shared/links";
import { MAX_SENDER } from "../notes";

// A name as it may be shown on notes: one line, no control or text-direction override characters, at most MAX_SENDER characters.
export const senderName = (name: string | undefined): string | undefined => [...cleanLine(name ?? "")].slice(0, MAX_SENDER).join("").trim() || undefined;

const bare = (issuer: string) => issuer.replace(/\/$/, "");

// What notefeed lets in, from the id_token's claims: the Better Auth user (name = the sender), or null after logging why not.
// Without an email (a `*` allow-list lets such a person in) the user gets a placeholder address, as Better Auth needs one.
export function person(p: Provider, claims: Record<string, unknown>): Record<string, unknown> | null {
  const email = typeof claims.email === "string" ? claims.email : undefined;
  const verified = claims.email_verified === true || claims.email_verified === "true";
  if (!allowed(p, { email, email_verified: verified })) {
    logFailure(email && verified ? "person not on the allow-list" : "address needs a verified email", { provider: p.id });
    return null;
  }
  const name = senderName(senderFrom(claims, p.senderClaim));
  if (!name) {
    logFailure("no sender claim in the id_token", { provider: p.id, claims: p.senderClaim.join(",") });
    return null;
  }
  const sub = String(claims.sub ?? "");
  return {
    ...claims,
    id: sub,
    sub,
    name,
    email: email ?? `${Buffer.from(sub).toString("hex")}@${p.id}.oidc.invalid`,
    emailVerified: email ? verified : false,
  };
}

function config(p: Provider): GenericOAuthConfig {
  return {
    providerId: p.id,
    discoveryUrl: `${bare(p.issuer)}/.well-known/openid-configuration`,
    clientId: p.clientId,
    clientSecret: p.clientSecret,
    scopes: ["openid", "profile", "email"],
    pkce: true,
    overrideUserInfo: true,
    // Only the id_token's claims, as before: no userinfo call. Better Auth has verified the token before this runs.
    getUserInfo: async (tokens) => {
      if (!tokens.idToken) {
        logFailure("token response has no id_token", { provider: p.id });
        return null;
      }
      let claims: Record<string, unknown>;
      try {
        claims = decodeJwt(tokens.idToken);
      } catch {
        logFailure("id_token invalid", { provider: p.id, check: "malformed" });
        return null;
      }
      return person(p, claims) as Awaited<ReturnType<NonNullable<GenericOAuthConfig["getUserInfo"]>>>;
    },
  };
}

export const genericOAuthPlugin = () => genericOAuth({ config: providers().map(config) });
