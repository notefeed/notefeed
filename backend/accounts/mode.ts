// Whether an instance has accounts, and who may create them (NOTEFEED_ACCOUNTS, ADR 0058):
//   off       no accounts (the default on an own instance, V12)
//   open      anyone may create one (notefeed.me); the instance stays open: feeds work without an account
//   provider  only through an identity provider and its allow-list (the team case); locks the instance
//   closed    only the operator creates them (/api/operator/accounts); locks the instance; no identity provider
// Unset with an identity provider configured means `provider`: a provider sign-in is an account. Must not import auth.ts.
import { config } from "../config";
import { identityOn } from "../oidc/config";

export const ACCOUNT_MODES = ["off", "open", "provider", "closed"] as const;
export type AccountsMode = (typeof ACCOUNT_MODES)[number];

const raw = () => (process.env.NOTEFEED_ACCOUNTS ?? "").trim().toLowerCase();

// An unknown value counts as off here; checkAccessSettings refuses it at start-up.
export function accountsMode(): AccountsMode {
  const v = raw();
  if (v === "") return identityOn() ? "provider" : "off";
  return (ACCOUNT_MODES as readonly string[]).includes(v) ? (v as AccountsMode) : "off";
}

export const accountsOn = (): boolean => accountsMode() !== "off";

// Accounts that keep people out of the instance until they sign in: provider and closed. Open accounts don't.
export const accountsLock = (): boolean => accountsMode() === "provider" || accountsMode() === "closed";

// The access settings that can't work together; thrown at start-up, so a wrong one never serves a request. Names variables, never values.
export function checkAccessSettings(): void {
  const v = raw();
  if (v !== "" && !(ACCOUNT_MODES as readonly string[]).includes(v)) throw new Error(`NOTEFEED_ACCOUNTS must be one of ${ACCOUNT_MODES.join(", ")}, or unset`);
  if (v === "off" && identityOn())
    throw new Error("an identity provider (NOTEFEED_OIDC_*) needs accounts: set NOTEFEED_ACCOUNTS to provider, open or closed, or remove the provider");
  if (accountsMode() === "closed" && identityOn())
    throw new Error("NOTEFEED_ACCOUNTS=closed can't have an identity provider (NOTEFEED_OIDC_*): its sign-ins would create accounts; use provider or open");
  if (accountsMode() === "provider" && !identityOn()) throw new Error("NOTEFEED_ACCOUNTS=provider needs an identity provider (NOTEFEED_OIDC_*)");
  if (accountsOn() && config.password() !== "")
    throw new Error("set NOTEFEED_PASSWORD or accounts, not both (an identity provider counts as accounts): scripts move to feed passwords; see Upgrading");
  if (accountsOn() && !config.publicUrl())
    throw new Error("accounts (NOTEFEED_ACCOUNTS or NOTEFEED_OIDC_*) need PUBLIC_URL, the address people reach notefeed at");
}
