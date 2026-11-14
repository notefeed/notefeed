import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { accountOf, accountsOn, listAccountTokens } from "@/backend";
import { AccountTokens, NewRecoveryKey, Passkeys } from "@/components/AccountSettings";
import { copyFor } from "@/shared/copy";

export const dynamic = "force-dynamic";

const section = "mt-8 border-t border-rule pt-6";

// The signed-in account (ADR 0057): its number, passkeys, a new recovery key, logging out and deleting it.
export default async function AccountPage({ params, searchParams }: PageProps<"/[lang]/account">) {
  const copy = copyFor((await params).lang);
  const t = copy.account;
  if (!accountsOn()) notFound();
  const account = await accountOf(await headers());
  if (!account) redirect("/login?next=/account");
  const { error } = await searchParams;
  return (
    <main>
      <h1 className="mb-4 text-xl font-bold tracking-tight">{t.title}</h1>
      {account.number ? (
        <p>
          <span className="mr-2 text-sm text-muted">{t.number}</span>
          <code className="font-mono text-[15px]">{account.number}</code>
        </p>
      ) : (
        <p className="text-muted">{t.viaProvider}</p>
      )}
      <form method="post" action="/logout" className="mt-4">
        <button type="submit" className="rounded-full bg-surface-2 px-4 py-1.5 font-bold">
          {copy.shell.logOut}
        </button>
      </form>

      <section className={section}>
        <h2 className="mb-1 font-bold">{t.passkeys}</h2>
        <p className="mb-3 text-sm text-muted">{t.passkeysIntro}</p>
        <Passkeys />
      </section>

      {account.number && (
        <section className={section}>
          <h2 className="mb-1 font-bold">{t.recoveryKey}</h2>
          <NewRecoveryKey />
        </section>
      )}

      <section className={section}>
        <h2 className="mb-1 font-bold">{t.tokens}</h2>
        <p className="mb-3 text-sm text-muted">{t.tokensIntro}</p>
        <AccountTokens tokens={(await listAccountTokens(account.userId)).map((k) => ({ id: k.id, name: k.name, scope: k.scope, expires_at: k.expiresAt }))} />
      </section>

      <section className={section}>
        <h2 className="mb-1 font-bold">{t.deleteTitle}</h2>
        <p className="mb-3 text-sm text-muted">{t.deleteIntro}</p>
        <form method="post" action="/api/accounts/delete" className="max-w-sm">
          <label htmlFor="confirm" className="mb-1 block text-sm text-muted">
            {account.number ? t.confirmNumber : t.confirmWord}
          </label>
          <div className="flex gap-2">
            <input
              id="confirm"
              name="confirm"
              required
              autoComplete="off"
              aria-describedby="delete-error"
              aria-invalid={error ? true : undefined}
              className="min-w-0 flex-1 rounded-xl border border-rule bg-surface px-3 py-1.5 focus:border-carbon focus:outline-none"
            />
            <button type="submit" className="rounded-full bg-error px-4 py-1.5 font-bold text-on-carbon">
              {t.delete}
            </button>
          </div>
          <p id="delete-error" role="alert" className="mt-2 text-sm text-error">
            {error === "confirm" ? t.confirmWrong : error === "fresh" ? t.signInAgain : null}
          </p>
        </form>
      </section>
    </main>
  );
}
