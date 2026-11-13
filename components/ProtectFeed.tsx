import Link from "next/link";
import { FeedPasswordIcon } from "@/components/icons";
import { messagesFor } from "@/app/_lib/messages";
import type { Copy } from "@/shared/copy";
import { CreateFeedButton } from "@/components/CreateFeedButton";
import { card, field, sectionLabel } from "@/components/styles";
import { PASSWORD_PATTERN } from "@/shared/password";

// "Protect this feed": the password (and, where the instance sells licenses, the license key) of a feed that doesn't exist
// yet, in the feed's details under its card (issue #205). They are the feed's, set once, not options of a note, but the first
// note creates the feed with them: the fields belong to the compose box's form (COMPOSE_FORM, components/Compose.tsx), which reads
// them on posting and checks the password's pattern with its own fields.
export const COMPOSE_FORM = "compose";

// `licensePage`: /license exists (ADR 0035), so the hint links to it. *Create feed without a note* makes the feed with these fields
// right away (#295); where licenses are sold that needs the key. `error`: why the last try was refused.
export function ProtectFeed({
  t: all,
  feed,
  licensing,
  licensePage,
  error,
}: {
  t: Copy;
  feed: string;
  licensing: boolean;
  licensePage: boolean;
  error?: string;
}) {
  const t = all.protectFeed;
  const { PASSWORD_HINT } = messagesFor(all);
  return (
    <section aria-labelledby="protect-feed" className={`${card} p-4 text-sm xl:p-5`}>
      <h2 id="protect-feed" className={`${sectionLabel} flex items-center gap-1.5`}>
        <FeedPasswordIcon aria-hidden className="h-3.5 w-3.5" />
        {t.title}
      </h2>
      <p className="mt-1 text-[13px] text-muted">{t.intro}</p>
      <label htmlFor="new-feed-password" className="mb-1 mt-3 block text-muted">
        {t.password}
      </label>
      <input
        id="new-feed-password"
        form={COMPOSE_FORM}
        name="password"
        type="password"
        autoComplete="new-password"
        maxLength={256}
        pattern={PASSWORD_PATTERN}
        title={PASSWORD_HINT}
        aria-describedby="new-feed-password-hint"
        className={field}
      />
      <p id="new-feed-password-hint" className="mt-1 text-[13px] text-muted">
        {PASSWORD_HINT}
      </p>
      {licensing && (
        <>
          <label htmlFor="new-feed-license-key" className="mb-1 mt-3 block text-muted">
            {t.licenseKey}
          </label>
          <input
            id="new-feed-license-key"
            form={COMPOSE_FORM}
            name="license_key"
            type="text"
            autoComplete="off"
            spellCheck={false}
            maxLength={64}
            aria-describedby="new-feed-license-key-hint"
            className={`${field} font-mono`}
          />
          <p id="new-feed-license-key-hint" className="mt-1 text-[13px] text-muted">
            {t.keyHint}{" "}
            {licensePage ? (
              <>
                <Link href="/license" className="text-carbon underline">
                  {t.buyLicense}
                </Link>{" "}
                {t.andEnterKey}
              </>
            ) : (
              t.enterKey
            )}
            {t.keyHintEnd}
          </p>
        </>
      )}
      <CreateFeedButton feed={feed} />
      {licensing && <p className="mt-1 text-[13px] text-muted">{t.withoutNoteNeedsKey}</p>}
      <p role="alert" className="mt-2 text-[13px] text-error empty:hidden">
        {error}
      </p>
    </section>
  );
}
