import { Lock } from "lucide-react";
import { card, field, primary } from "@/components/styles";

// The feed password screen: a plain form, POST /<feed>/access sets the unlock cookie and returns to the feed.
export function UnlockForm({ feed, error }: { feed: string; error?: string }) {
  return (
    <div className={`${card} mx-auto mt-[8vh] max-w-sm p-6`}>
      <span className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-carbon-soft text-carbon">
        <Lock aria-hidden className="h-5 w-5" />
      </span>
      <form method="post" action={`/${feed}/access`}>
        <input type="hidden" name="action" value="unlock" />
        <label htmlFor="feed-password" className="mb-1 block text-sm text-muted">
          Feed password
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
            Unlock
          </button>
        </div>
        <p id="unlock-error" role="alert" className="mt-2 text-sm text-error empty:hidden">
          {error}
        </p>
      </form>
    </div>
  );
}
