// Accounts that are a number, not a person (ADR 0057): a generated account number (Better Auth's username) and a recovery key (its
// password), shown once. Nothing about who holds the account is stored: the e-mail Better Auth requires is a placeholder and the
// name is empty, so notes posted by such an account carry no sender of its own. Lose the number, the key and every passkey, and
// the account is gone.
import { randomInt } from "node:crypto";
import { AuthError } from "../errors";
import { accountsAuth } from "./auth";

const DIGITS = 16;
// Crockford's base32 without I, L, O and U: nothing to misread when it is copied by hand.
const KEY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const formatNumber = (n: string): string => n.replace(/(\d{4})(?=\d)/g, "$1-");

// What a person typed (spaces, dashes) as the stored number, or null when it isn't one.
export function parseNumber(typed: string): string | null {
  const n = typed.replace(/[\s-]/g, "");
  return new RegExp(`^[1-9]\\d{${DIGITS - 1}}$`).test(n) ? n : null;
}

const newNumber = () => String(randomInt(1, 10)) + Array.from({ length: DIGITS - 1 }, () => randomInt(0, 10)).join("");
// 25 characters in groups of five, 125 bits.
const newKey = () =>
  Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => KEY_ALPHABET[randomInt(0, KEY_ALPHABET.length)]).join("")).join("-");

function auth() {
  const a = accountsAuth();
  if (!a) throw new Error("accounts are off");
  return a;
}

const placeholderEmail = (number: string) => `${number}@accounts.invalid`;

// A new account. The number and key are returned once; only the key's hash is kept.
export async function createAccount(): Promise<{ number: string; recoveryKey: string; userId: string }> {
  const a = auth();
  const ctx = await a.$context;
  for (let attempt = 0; ; attempt++) {
    const number = newNumber();
    if (await ctx.internalAdapter.findUserByEmail(placeholderEmail(number))) {
      if (attempt > 5) throw new Error("no free account number");
      continue;
    }
    const recoveryKey = newKey();
    // `username` comes from the username plugin, which the inferred body type doesn't carry here.
    const body = { email: placeholderEmail(number), password: recoveryKey, name: "", username: number };
    const { user } = await a.api.signUpEmail({ body: body as typeof body & { name: string } });
    return { number, recoveryKey, userId: user.id };
  }
}

// Signs in with a number (as typed) and the recovery key: the session's Set-Cookie headers. AuthError for anything wrong; the
// caller counts it toward the failed-attempt limit.
export async function signInWithNumber(typed: string, recoveryKey: string, h: Headers): Promise<string[]> {
  const number = parseNumber(typed);
  if (!number || !recoveryKey) throw new AuthError();
  const out = await auth()
    .api.signInUsername({ body: { username: number, password: recoveryKey.trim().toUpperCase() }, headers: h, returnHeaders: true })
    .catch(() => null);
  if (!out?.response) throw new AuthError();
  return out.headers.getSetCookie();
}

// A new recovery key for the account, replacing the old one; returned once.
export async function newRecoveryKey(userId: string): Promise<string> {
  const ctx = await auth().$context;
  const key = newKey();
  await ctx.internalAdapter.updatePassword(userId, await ctx.password.hash(key));
  return key;
}

// The account with its sessions, passkeys and sign-in records. Its feeds (step 2c) and subscriptions (step 3) come first, there.
export async function deleteAccount(userId: string): Promise<void> {
  const ctx = await auth().$context;
  await ctx.adapter.deleteMany({ model: "passkey", where: [{ field: "userId", value: userId }] });
  await ctx.internalAdapter.deleteUser(userId); // with its sessions and sign-in records
}

// The account number of a signed-in account, or undefined for one made through an identity provider.
export async function accountNumber(userId: string): Promise<string | undefined> {
  const ctx = await auth().$context;
  const user = (await ctx.internalAdapter.findUserById(userId)) as { username?: string | null } | null;
  return user?.username ?? undefined;
}
