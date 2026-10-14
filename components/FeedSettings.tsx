import { KeyRound, Lock } from "lucide-react";
import { DisclosureRow, Group, Row } from "@/components/SettingsRows";
import { field, primary, secondary } from "@/components/styles";
import { PASSWORD_HINT } from "@/app/_lib/messages";
import { PASSWORD_PATTERN } from "@/shared/password";

// Shown on a protected feed once unlocked: plain forms to POST /<feed>/access. `error` opens the password row.
export function FeedSettings({ feed, error }: { feed: string; error?: string }) {
  const action = `/${feed}/access`;
  return (
    <Group id="access" label="Privacy & access">
      <DisclosureRow icon={<KeyRound />} label="Feed password" value="On" open={!!error}>
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
