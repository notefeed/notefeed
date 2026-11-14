"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { messagesFor } from "@/app/_lib/messages";
import { CopyButton } from "@/components/CopyButton";
import { useCopy, useLocale } from "@/components/CopyProvider";

// A feed's owner and its passwords (ADR 0059), on the feed's settings page. The list comes from the server; adding, revoking and
// claiming go to the API from this page (a same-origin request carries the account's session).
const api = (feed: string, path: string) => `/api/v1/feeds/${encodeURIComponent(feed)}${path}`;
const field = "min-w-0 flex-1 rounded-xl border border-rule bg-surface px-3 py-1.5 focus:border-carbon focus:outline-none";

async function refusal(res: Response | null, t: ReturnType<typeof useCopy>): Promise<string> {
  const code = res ? ((await res.json().catch(() => null)) as { code?: string } | null)?.code : undefined;
  return messagesFor(t).errorMessage(code, res?.headers.get("retry-after") ?? undefined) ?? t.owner.failed;
}

export function FeedPasswords({ feed, passwords }: { feed: string; passwords: { id: string; name: string; created: string | null }[] }) {
  const copy = useCopy();
  const t = copy.owner;
  const lang = useLocale();
  const router = useRouter();
  const [name, setName] = useState("");
  const [shown, setShown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const send = async (method: string, path: string, body?: unknown) => {
    setError(null);
    const res = await fetch(api(feed, path), {
      method,
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    }).catch(() => null);
    if (!res?.ok) setError(await refusal(res, copy));
    return res?.ok ? res : null;
  };
  const add = async () => {
    const res = await send("POST", "/passwords", { name: name.trim() });
    if (res) {
      setShown((await res.json()).password);
      setName("");
      router.refresh();
    }
  };
  const revoke = async (id: string) => {
    if (await send("DELETE", `/passwords/${encodeURIComponent(id)}`)) router.refresh();
  };
  return (
    <div>
      <p className="mb-2 text-sm text-muted">{t.yours}</p>
      <h3 className="mb-1 font-bold">{t.passwordsHeading}</h3>
      <p className="mb-3 text-sm text-muted">{t.passwordsIntro}</p>
      {passwords.length === 0 && <p className="mb-3 text-sm text-muted">{t.noPasswords}</p>}
      <ul className="mb-4">
        {passwords.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 py-1">
            <span>
              <span className="font-bold">{p.name}</span>
              {p.created && <span className="text-sm text-muted"> · {t.added(new Date(p.created).toLocaleDateString(lang))}</span>}
            </span>
            <button type="button" onClick={() => revoke(p.id)} className="text-sm text-muted underline">
              {t.revoke}
            </button>
          </li>
        ))}
      </ul>
      {shown && (
        <div className="mb-4">
          <p className="mb-1 text-sm font-bold">{t.shown}</p>
          <div className="flex items-center gap-2">
            <code className="rounded-lg bg-surface-2 px-3 py-1.5 font-mono text-[15px]">{shown}</code>
            <CopyButton text={shown} />
          </div>
        </div>
      )}
      <label htmlFor="feed-password-name" className="mb-1 block text-sm text-muted">
        {t.nameLabel}
      </label>
      <div className="flex max-w-md gap-2">
        <input
          id="feed-password-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={50}
          placeholder={t.namePlaceholder}
          className={field}
        />
        <button type="button" onClick={add} disabled={!name.trim()} className="shrink-0 rounded-full bg-carbon px-4 py-1.5 font-bold text-on-carbon">
          {t.add}
        </button>
      </div>
      <p role="alert" className="mt-2 text-sm text-error">
        {error}
      </p>
    </div>
  );
}

export function ClaimFeed({ feed, isProtected }: { feed: string; isProtected: boolean }) {
  const copy = useCopy();
  const t = copy.owner;
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const claim = async () => {
    setError(null);
    const res = await fetch(api(feed, "/claim"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) }).catch(
      () => null,
    );
    if (res?.ok) router.refresh();
    else setError(await refusal(res, copy));
  };
  return (
    <div className="mt-6">
      <h3 className="mb-1 font-bold">{t.claimHeading}</h3>
      <p className="mb-3 text-sm text-muted">{isProtected ? t.claimProtected : t.claimOpen}</p>
      <label htmlFor="claim-password" className="mb-1 block text-sm text-muted">
        {t.password}
      </label>
      <div className="flex max-w-md gap-2">
        <input
          id="claim-password"
          type="password"
          autoComplete={isProtected ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={field}
        />
        <button type="button" onClick={claim} disabled={!password} className="shrink-0 rounded-full bg-carbon px-4 py-1.5 font-bold text-on-carbon">
          {t.claim}
        </button>
      </div>
      <p role="alert" className="mt-2 text-sm text-error">
        {error}
      </p>
    </div>
  );
}
