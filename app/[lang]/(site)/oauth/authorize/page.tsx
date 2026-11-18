import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { messagesFor } from "@/app/_lib/messages";
import { copyFor } from "@/shared/copy";
import Link from "next/link";
import { accountOf, accountsAuth, oauthAuth, oauthClient, oauthQuery } from "@/backend";

export const dynamic = "force-dynamic";

const Failed = ({ message }: { message: string }) => (
  <main className="mt-[6vh]">
    <h1 className="mb-6 text-xl font-bold tracking-tight">notefeed</h1>
    <p role="alert" className="text-error">
      {message}
    </p>
  </main>
);

// Better Auth's login and consent page for MCP clients (ADR 0062). With accounts, the account signed in on these pages allows the
// client or denies it, and signed out, the login page brings you back here; on an instance the password locks, the password lets
// it in. Both forms post to /api/oauth/authorize, which sends the browser back to the client, or back here with ?error=. An open
// instance without accounts has no OAuth.
export default async function AuthorizePage({ params: route, searchParams }: PageProps<"/[lang]/oauth/authorize">) {
  const t = copyFor((await route).lang);
  const { errorMessage } = messagesFor(t);
  const { error, retry, ...rest } = await searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(rest)) for (const one of [v ?? []].flat()) params.append(k, one);
  const auth = oauthAuth();
  if (!auth) notFound();
  const query = await oauthQuery(auth, params);
  const client = query ? await oauthClient(auth, query) : null;
  if (!query || !client) return <Failed message={t.login.expired} />;
  const message = errorMessage(error, retry);
  return accountsAuth() ? accountConsent(t, query, client, message) : passwordLogin(t, query, client, message, !!error);
}

type Client = { name: string; redirectHost: string };

function passwordLogin(t: ReturnType<typeof copyFor>, query: string, client: Client, error: string | undefined, failed: boolean) {
  return (
    <main className="mt-[6vh]">
      <h1 className="mb-2 text-xl font-bold tracking-tight">{t.login.connect(client.name)}</h1>
      <p className="mb-6 text-muted">{t.login.sentTo(client.redirectHost)}</p>
      <form method="post" action="/api/oauth/authorize" className="max-w-sm">
        <input type="hidden" name="oauth_query" value={query} />
        <label htmlFor="password" className="mb-1 block text-sm text-muted">
          {t.login.password}
        </label>
        <div className="flex gap-2">
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
            aria-describedby="login-error"
            aria-invalid={failed ? true : undefined}
            className="min-w-0 flex-1 rounded-xl border border-rule bg-surface px-3 py-1.5 focus:border-carbon focus:outline-none"
          />
          <button type="submit" className="rounded-full bg-carbon px-4 py-1.5 font-bold text-on-carbon">
            {t.login.allow}
          </button>
        </div>
        <p id="login-error" role="alert" className="mt-2 text-sm text-error">
          {error}
        </p>
      </form>
    </main>
  );
}

async function accountConsent(t: ReturnType<typeof copyFor>, query: string, client: Client, error: string | undefined) {
  const account = await accountOf(await headers());
  return (
    <main className="mt-[6vh]">
      <h1 className="mb-2 text-xl font-bold tracking-tight">{t.login.connect(client.name)}</h1>
      <p className="mb-6 text-muted">{t.login.sentTo(client.redirectHost)}</p>
      <div className="mb-6 max-w-sm">
        {account ? (
          <form method="post" action="/api/oauth/authorize">
            <input type="hidden" name="oauth_query" value={query} />
            <div className="flex gap-2">
              <button type="submit" name="accept" value="1" className="rounded-full bg-carbon px-4 py-1.5 font-bold text-on-carbon">
                {t.login.allowAccount}
              </button>
              <button type="submit" name="accept" value="0" className="rounded-full border border-rule px-4 py-1.5">
                {t.login.deny}
              </button>
            </div>
            <p className="mt-2 text-sm text-muted">{account.number ? t.login.asAccount(account.number) : t.login.asYou}</p>
          </form>
        ) : (
          <Link
            href={`/login?next=${encodeURIComponent(`/oauth/authorize?${query}`)}`}
            className="inline-block rounded-full bg-carbon px-4 py-1.5 font-bold text-on-carbon"
          >
            {t.login.signInFirst}
          </Link>
        )}
      </div>
      <p id="login-error" role="alert" className="mt-2 text-sm text-error">
        {error}
      </p>
    </main>
  );
}
