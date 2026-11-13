import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { messagesFor } from "@/app/_lib/messages";
import { copyFor } from "@/shared/copy";
import { checkAuthorize, identityOn, locked, passwordSet, signInProviders } from "@/backend";

export const dynamic = "force-dynamic";

// The OAuth login: the instance password lets an MCP client in. The form posts to /api/oauth/authorize,
// which redirects back to the client with a code, or back here with ?error=.
export default async function AuthorizePage({ params: route, searchParams }: PageProps<"/[lang]/oauth/authorize">) {
  const t = copyFor((await route).lang);
  const { SENDER_NOTICE, errorMessage } = messagesFor(t);
  if (!locked()) notFound();
  const { error, retry, ...rest } = await searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(rest)) for (const one of [v ?? []].flat()) params.append(k, one);
  const checked = checkAuthorize(params, await headers());
  if (checked.kind === "redirect") redirect(checked.location);
  if (checked.kind === "error")
    return (
      <main className="mt-[6vh]">
        <h1 className="mb-6 text-xl font-bold tracking-tight">notefeed</h1>
        <p role="alert" className="text-error">
          {checked.message}
        </p>
      </main>
    );
  return (
    <main className="mt-[6vh]">
      <h1 className="mb-2 text-xl font-bold tracking-tight">{t.login.connect(checked.clientName)}</h1>
      <p className="mb-6 text-muted">{t.login.sentTo(checked.redirectHost)}</p>
      {identityOn() && (
        // A form POST, not a link: a cross-site GET must never start an MCP sign-in.
        <div className="mb-6 max-w-sm">
          <div className="flex flex-col items-start gap-2">
            {signInProviders().map(({ id, label }) => (
              <form key={id} method="post" action="/api/oidc/start">
                {Object.entries(checked.fields).map(([name, value]) => (
                  <input key={name} type="hidden" name={name} value={value} />
                ))}
                <input type="hidden" name="provider" value={id} />
                <button type="submit" className="rounded-full bg-carbon px-4 py-1.5 font-bold text-on-carbon">
                  {label ? t.login.signInWith(label) : t.login.signIn}
                </button>
              </form>
            ))}
          </div>
          <p className="mt-2 text-sm text-muted">{SENDER_NOTICE}</p>
        </div>
      )}
      {passwordSet() && (
        <form method="post" action="/api/oauth/authorize" className="max-w-sm">
          {Object.entries(checked.fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
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
              aria-invalid={error ? true : undefined}
              className="min-w-0 flex-1 rounded-xl border border-rule bg-surface px-3 py-1.5 focus:border-carbon focus:outline-none"
            />
            <button type="submit" className="rounded-full bg-carbon px-4 py-1.5 font-bold text-on-carbon">
              {t.login.allow}
            </button>
          </div>
          <p id="login-error" role="alert" className="mt-2 text-sm text-error">
            {errorMessage(error, retry)}
          </p>
        </form>
      )}
      {!passwordSet() && (
        <p id="login-error" role="alert" className="mt-2 text-sm text-error">
          {errorMessage(error, retry)}
        </p>
      )}
    </main>
  );
}
