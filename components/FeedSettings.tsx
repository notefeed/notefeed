import { KeyRound, Lock, ShieldCheck } from "lucide-react";
import { DisclosureRow, Group, Row } from "@/components/SettingsRows";
import { field, primary, secondary } from "@/components/styles";
import { PASSWORD_HINT } from "@/app/_lib/messages";
import { PASSWORD_PATTERN } from "@/shared/password";

// Shown on a protected feed once unlocked: plain forms to POST /<feed>/access. `error`, `notice` (what a change just did, #296) and an
// open `recover` open the password row. `recover` is set where licenses are sold: a browser that is still unlocked but whose owner
// lost the password resets it with the feed's license key (ADR 0037, #297).
export function FeedSettings({ feed, error, notice, recover }: { feed: string; error?: string; notice?: string; recover?: { open: boolean; error?: string } }) {
  const action = `/${feed}/access`;
  return (
    <Group id="access" label="Privacy & access">
      <DisclosureRow icon={<KeyRound />} label="Feed password" value="On" open={!!error || !!notice || !!recover?.open}>
        {notice && (
          <p role="status" className="mb-3 max-w-sm rounded-xl bg-carbon-soft px-3 py-2 text-carbon">
            {notice}
          </p>
        )}
        <form method="post" action={action} className="max-w-sm">
          <label htmlFor="current-password" className="mb-1 block text-muted">
            Current password
          </label>
          <input id="current-password" name="current" type="password" autoComplete="current-password" required maxLength={256} className={`${field} mb-3`} />
          <label htmlFor="new-password" className="mb-1 block text-muted">
            New password
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
              Change
            </button>
            <button type="submit" name="action" value="remove" formNoValidate className={`${secondary} bg-transparent font-normal text-muted`}>
              Remove password
            </button>
          </div>
          <p className="mt-2 text-muted">Removing it needs the current password too.</p>
        </form>
        {recover && (
          <details className="mt-4 max-w-sm" open={recover.open}>
            <summary className="cursor-pointer text-muted">Forgot the current password?</summary>
            <form method="post" action={action} className="mt-3">
              <input type="hidden" name="action" value="recover" />
              <input type="hidden" name="from" value="settings" />
              <p className="mb-3 text-muted">
                Enter this feed&apos;s license key: it is in the payment provider&apos;s receipt e-mail and customer portal. Then choose a new password, or
                leave it empty to remove the password.
              </p>
              <label htmlFor="settings-recover-key" className="mb-1 block text-muted">
                This feed&apos;s license key
              </label>
              <input id="settings-recover-key" name="key" required autoComplete="off" spellCheck={false} maxLength={64} className={`${field} mb-3 w-full font-mono`} />
              <label htmlFor="settings-recover-next" className="mb-1 block text-muted">
                New password (empty removes it)
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
                Reset with license key
              </button>
              <p id="settings-recover-error" role="alert" className="mt-2 text-error empty:hidden">
                {recover.error}
              </p>
            </form>
          </details>
        )}
      </DisclosureRow>
      <Row icon={<Lock />} label="This browser" hint="Asks for the password again here">
        <form method="post" action={action}>
          <button type="submit" name="action" value="lock" className={secondary}>
            Lock this browser
          </button>
        </form>
      </Row>
    </Group>
  );
}

// Shown on an open feed (ADR 0044): whoever has access to it, which is whoever knows its name, may give it a password, and so claim
// it. Plain form to POST /<feed>/access. `error` opens the row.
export function ProtectFeed({ feed, error }: { feed: string; error?: string }) {
  return (
    <Group id="access" label="Privacy & access">
      <DisclosureRow icon={<ShieldCheck />} label="Feed password" value="Off" open={!!error}>
        <form method="post" action={`/${feed}/access`} className="max-w-sm">
          <p className="mb-3 text-muted">
            Anyone who knows this feed&apos;s name can read, post to and change it, and set this password too. A password stops that: from then on everyone who posts, scripts included, needs it, and so does this page. The read link and RSS stay open.
          </p>
          <label htmlFor="protect-password" className="mb-1 block text-muted">
            Password
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
            Set password
          </button>
        </form>
      </DisclosureRow>
    </Group>
  );
}
