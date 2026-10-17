import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import { PASSWORD_HINT } from "@/app/_lib/messages";
import { card, field, sectionLabel } from "@/components/styles";
import { PASSWORD_PATTERN } from "@/shared/password";

// "Protect this feed": the password (and, where the instance sells licenses, the license key) of a feed that doesn't exist
// yet, in the feed's details under its card (issue #205). They are the feed's, set once, not options of a note, but the first
// note creates the feed with them: the fields belong to the compose box's form (COMPOSE_FORM, components/Compose.tsx), which reads
// them on posting and checks the password's pattern with its own fields.
export const COMPOSE_FORM = "compose";

export function ProtectFeed({ licensing }: { licensing: boolean }) {
  return (
    <section aria-labelledby="protect-feed" className={`${card} p-4 text-sm xl:p-5`}>
      <h2 id="protect-feed" className={`${sectionLabel} flex items-center gap-1.5`}>
        <LockKeyhole aria-hidden className="h-3.5 w-3.5" />
        Protect this feed
      </h2>
      <p className="mt-1 text-[13px] text-muted">A feed can only get a password when it is created: the first note creates it with this one.</p>
      <label htmlFor="new-feed-password" className="mb-1 mt-3 block text-muted">
        Password (optional, protects this feed)
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
            License key (needed with a password)
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
            A feed password is for licensed feeds.{" "}
            <Link href="/license" className="text-carbon underline">
              Buy a license
            </Link>{" "}
            and enter its key here: the first note then creates the feed protected and licensed.
          </p>
        </>
      )}
    </section>
  );
}
