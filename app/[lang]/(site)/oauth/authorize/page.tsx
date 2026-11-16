import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { messagesFor } from "@/app/_lib/messages";
import { copyFor } from "@/shared/copy";
import Link from "next/link";
import { accountOf, accountsAuth, oauthClient, oauthQuery } from "@/backend";

export const dynamic = "force-dynamic";

const Failed = ({ message }: { message: string }) => (
  <main className="mt-[6vh]">
    <h1 className="mb-6 text-xl font-bold tracking-tight">notefeed</h1>
    <p role="alert" className="text-error">
      {message}
    </p>
  </main>
);

// Better Auth's login and consent page for MCP clients (ADR 0062): the account signed in on these pages allows the client or denies
// it (the form posts to /api/oauth/authorize, which sends the browser back to the client), and signed out, the login page brings
// you back here. Only where there are accounts; without them there is no OAuth.
export default async function AuthorizePage({ params: route, searchParams }: PageProps<"/[lang]/oauth/authorize">) {
  const t = copyFor((await route).lang);
  const { errorMessage } = messagesFor(t);
  const { error, retry, ...rest } = await searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(rest)) for (const one of [v ?? []].flat()) params.append(k, one);
  if (!accountsAuth()) notFound();
  return accountConsent(t, params, errorMessage(error, retry));
}

async function accountConsent(t: ReturnType<typeof copyFor>, params: URLSearchParams, error: string | undefined) {
  const auth = accountsAuth()!;
  const h = await headers();
  const query = await oauthQuery(auth, params);
  const client = query ? await oauthClient(auth, query) : null;
  if (!query || !client) return <Failed message={t.login.expired} />;
  const account = await accountOf(h);
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
