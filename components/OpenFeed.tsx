import Link from "next/link";
import { Shuffle } from "lucide-react";
import { field, primary } from "@/components/styles";

// A plain GET form: the start page normalizes and checks the name, then redirects to /<name>.
// Works without JavaScript. The shuffle link loads the start page again, with another suggested name.
// `carry`: what was shared to notefeed, passed on to the feed (app/(site)/page.tsx).
export function OpenFeed({ value, error, carry = [] }: { value: string; error?: string; carry?: [string, string][] }) {
  return (
    <form method="get" action="/">
      {carry.map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <label htmlFor="feed" className="mb-1 block text-sm text-muted">
        Feed name
      </label>
      <div className="flex gap-2">
        <input
          id="feed"
          name="feed"
          defaultValue={value}
          required
          autoFocus
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          aria-describedby="feed-error"
          aria-invalid={error ? true : undefined}
          className={`${field} flex-1 font-mono`}
        />
        <Link href="/" prefetch={false} aria-label="Suggest another name" title="Suggest another name" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink hover:bg-rule/60">
          <Shuffle aria-hidden className="h-[18px] w-[18px]" />
        </Link>
        <button type="submit" className={primary}>
          Open
        </button>
      </div>
      <p id="feed-error" role="alert" className="mt-2 text-sm text-error empty:hidden">
        {error}
      </p>
    </form>
  );
}
