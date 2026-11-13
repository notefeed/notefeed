import { LockedIcon } from "@/components/icons";
import { card, field, primary, secondary } from "@/components/styles";
import { PASSWORD_PATTERN } from "@/shared/password";
import { serverCopy } from "@/app/_lib/copy";

// The feed password screen: a plain form, POST /<feed>/access sets the unlock cookie and returns to the feed. `recover` is set
// where licenses are sold (ADR 0037): a lost password is set anew or removed with the feed's license key; `open` when the
// last attempt was that form's. `share`: what was shared to notefeed (shared/share.ts), carried through the unlock to the compose box.
export async function UnlockForm({
  feed,
  error,
  recover,
  share = "",
}: {
  feed: string;
  error?: string;
  recover?: { open: boolean; error?: string };
  share?: string;
}) {
  const t = (await serverCopy()).unlock;
  return (
    <div className={`${card} mx-auto mt-[8vh] max-w-sm p-6`}>
      <span className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-carbon-soft text-carbon">
        <LockedIcon aria-hidden className="h-5 w-5" />
      </span>
      <form method="post" action={`/${feed}/access`}>
        <input type="hidden" name="action" value="unlock" />
        {share && <input type="hidden" name="share" value={share} />}
        <label htmlFor="feed-password" className="mb-1 block text-sm text-muted">
          {t.password}
        </label>
        <div className="flex gap-2">
          <input
            id="feed-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
            maxLength={256}
            aria-describedby="unlock-error"
            aria-invalid={error ? true : undefined}
            className={`${field} flex-1`}
          />
          <button type="submit" className={primary}>
            {t.unlock}
          </button>
        </div>
        <p id="unlock-error" role="alert" className="mt-2 text-sm text-error empty:hidden">
          {error}
        </p>
      </form>
      {recover && (
        <details className="mt-5 text-sm" open={recover.open}>
          <summary className="cursor-pointer text-muted">{t.forgot}</summary>
          <form method="post" action={`/${feed}/access`} className="mt-3">
            <input type="hidden" name="action" value="recover" />
            <p className="mb-3 text-muted">{t.recoverIntro}</p>
            <label htmlFor="recover-key" className="mb-1 block text-muted">
              {t.licenseKey}
            </label>
            <input id="recover-key" name="key" required autoComplete="off" spellCheck={false} maxLength={64} className={`${field} mb-3 w-full font-mono`} />
            <label htmlFor="recover-next" className="mb-1 block text-muted">
              {t.newPassword}
            </label>
            <input
              id="recover-next"
              name="next"
              type="password"
              autoComplete="new-password"
              pattern={PASSWORD_PATTERN}
              maxLength={256}
              aria-describedby="recover-error"
              aria-invalid={recover.error ? true : undefined}
              className={`${field} mb-3 w-full`}
            />
            <button type="submit" className={secondary}>
              {t.recover}
            </button>
            <p id="recover-error" role="alert" className="mt-2 text-error empty:hidden">
              {recover.error}
            </p>
          </form>
        </details>
      )}
    </div>
  );
}
