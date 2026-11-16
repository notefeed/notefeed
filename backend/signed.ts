// Stateless signed values: where a provider sign-in in flight goes back to (oidc/routes.ts), and the key Better Auth's secret is
// derived from. base64url(JSON payload) "." base64url(HMAC-SHA256). The key is derived from the server secret and the password,
// so changing either one invalidates every value and cookie signed here.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config";
import { secret } from "./feeds";

export type Kind = "oidc";
export type Payloads = {
  oidc: { provider: string; nonce: string; next?: string }; // a sign-in in flight, through `provider` (its id): where it goes back to, and the nonce of the browser that started it (its nf_oidc cookie)
};
// A sign-in through a provider (the Better Auth session, accounts/auth.ts) ends after `idle` unused, is renewed at most every
// `renew` while used, and ends `signInMax` after it was made whatever the use (ADR 0056).
export const TTL = { idle: 2592000, renew: 86400, signInMax: 7776000, oidc: 600 } as const;

// Derived per call (secret() is cached, the password is not, and either may change); also the root of Better Auth's secret.
export function key(): Buffer {
  const pw = createHash("sha256")
    .update(config.password() ?? "")
    .digest();
  return createHmac("sha256", secret()).update(pw).digest();
}

const mac = (body: string) => createHmac("sha256", key()).update(body).digest();

export function sign<K extends Kind>(t: K, p: Payloads[K], now = Date.now()): string {
  const claims = { ...p, t, exp: Math.floor(now / 1000) + TTL[t] };
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${body}.${mac(body).toString("base64url")}`;
}

export function verify<K extends Kind>(t: K, token: string, now = Date.now()): (Payloads[K] & { exp?: number }) | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const want = mac(body);
  const got = Buffer.from(sig, "base64url");
  // The round trip rejects non-canonical encodings (the last char of a 32-byte MAC has spare bits).
  if (got.length !== want.length || got.toString("base64url") !== sig || !timingSafeEqual(got, want)) return null;
  // Only a token we signed gets parsed and its claims trusted.
  let claims: { t?: unknown; exp?: unknown };
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return null;
  }
  if (!claims || typeof claims !== "object" || claims.t !== t) return null;
  if (!(typeof claims.exp === "number" && now <= claims.exp * 1000)) return null;
  return claims as Payloads[K] & { exp?: number };
}
