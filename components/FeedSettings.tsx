import { FeedPasswordIcon, LockedIcon } from "@/components/icons";
import { DisclosureRow, Group, Row } from "@/components/SettingsRows";
import { field, primary, secondary } from "@/components/styles";
import { messagesFor } from "@/app/_lib/messages";
import { serverCopy } from "@/app/_lib/copy";
import { PASSWORD_PATTERN } from "@/shared/password";

// Shown on a protected feed once unlocked: plain forms to POST /<feed>/access. `error`, `notice` (what a change just did, #296) and an
// open `recover` open the password row. `recover` is set where licenses are sold: a browser that is still unlocked but whose owner
// lost the password resets it with the feed's license key (ADR 0037, #297).
export async function FeedSettings({
  feed,
  error,
  notice,
  recover,
}: {
  feed: string;
  error?: string;
  notice?: string;
  recover?: { open: boolean; error?: string };
}) {
  const action = `/${feed}/access`;
  const all = await serverCopy();
  const t = all.access;
  const { PASSWORD_HINT } = messagesFor(all);
  return (
    <Group id="access" label={t.title}>
      <DisclosureRow icon={<FeedPasswordIcon />} label={t.feedPassword} value={t.on} open={!!error || !!notice || !!recover?.open}>
        {notice && (
          <p role="status" className="mb-3 max-w-sm rounded-xl bg-carbon-soft px-3 py-2 text-carbon">
            {notice}
          </p>
        )}
        <form method="post" action={action} className="max-w-sm">
          <label htmlFor="current-password" className="mb-1 block text-muted">
            {t.current}
          </label>
          <input id="current-password" name="current" type="password" autoComplete="current-password" required maxLength={256} className={`${field} mb-3`} />
          <label htmlFor="new-password" className="mb-1 block text-muted">
            {t.newPassword}
          </label>
          <input
            id="new-password"
            name="next"
            type="password"
            autoComplete="new-password"
            required
            maxLength={256}
            pattern={PASSWORD_PATTERN}
            title={PASSWORD_HINT}
            aria-describedby="new-password-hint settings-error"
            className={field}
          />
          <p id="new-password-hint" className="mt-1 text-muted">
            {PASSWORD_HINT}
          </p>
          <p id="settings-error" role="alert" className="mt-2 text-error empty:hidden">
            {error}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="submit" name="action" value="change" className={primary}>
              {t.change}
            </button>
            <button type="submit" name="action" value="remove" formNoValidate className={`${secondary} bg-transparent font-normal text-muted`}>
              {t.remove}
            </button>
          </div>
          <p className="mt-2 text-muted">{t.removeNeedsCurrent}</p>
        </form>
        {recover && (
          <details className="mt-4 max-w-sm" open={recover.open}>
            <summary className="cursor-pointer text-muted">{t.forgotCurrent}</summary>
            <form method="post" action={action} className="mt-3">
              <input type="hidden" name="action" value="recover" />
              <input type="hidden" name="from" value="settings" />
              <p className="mb-3 text-muted">{t.recoverIntro}</p>
              <label htmlFor="settings-recover-key" className="mb-1 block text-muted">
                {t.feedKey}
              </label>
              <input
                id="settings-recover-key"
                name="key"
                required
                autoComplete="off"
                spellCheck={false}
                maxLength={64}
                className={`${field} mb-3 w-full font-mono`}
              />
              <label htmlFor="settings-recover-next" className="mb-1 block text-muted">
                {t.newPasswordEmpty}
              </label>
              <input
                id="settings-recover-next"
                name="next"
                type="password"
                autoComplete="new-password"
                pattern={PASSWORD_PATTERN}
                title={PASSWORD_HINT}
                maxLength={256}
                aria-describedby="settings-recover-error"
                aria-invalid={recover.error ? true : undefined}
                className={`${field} mb-3 w-full`}
              />
              <button type="submit" className={secondary}>
                {t.resetWithKey}
              </button>
              <p id="settings-recover-error" role="alert" className="mt-2 text-error empty:hidden">
                {recover.error}
              </p>
            </form>
          </details>
        )}
      </DisclosureRow>
      <Row icon={<LockedIcon />} label={t.thisBrowser} hint={t.asksAgain}>
        <form method="post" action={action}>
          <button type="submit" name="action" value="lock" className={secondary}>
            {t.lock}
          </button>
        </form>
      </Row>
    </Group>
  );
}

// Shown on an open feed (ADR 0044): whoever has access to it, which is whoever knows its name, may give it a password, and so claim
// it. Plain form to POST /<feed>/access. `error` opens the row.
export async function ProtectFeed({ feed, error }: { feed: string; error?: string }) {
  const all = await serverCopy();
  const t = all.access;
  const { PASSWORD_HINT } = messagesFor(all);
  return (
    <Group id="access" label={t.title}>
      <DisclosureRow icon={<FeedPasswordIcon />} label={t.feedPassword} value={t.off} open={!!error}>
        <form method="post" action={`/${feed}/access`} className="max-w-sm">
          <p className="mb-3 text-muted">{t.openIntro}</p>
          <label htmlFor="protect-password" className="mb-1 block text-muted">
            {t.password}
          </label>
          <input
            id="protect-password"
            name="next"
            type="password"
            autoComplete="new-password"
            required
            maxLength={256}
            pattern={PASSWORD_PATTERN}
            title={PASSWORD_HINT}
            aria-describedby="protect-password-hint protect-error"
            className={field}
          />
          <p id="protect-password-hint" className="mt-1 text-muted">
            {PASSWORD_HINT}
          </p>
          <p id="protect-error" role="alert" className="mt-2 text-error empty:hidden">
            {error}
          </p>
          <button type="submit" name="action" value="protect" className={`${primary} mt-3`}>
            {t.set}
          </button>
        </form>
      </DisclosureRow>
    </Group>
  );
}
