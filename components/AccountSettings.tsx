"use client";

import { useEffect, useState } from "react";
import { CopyButton } from "@/components/CopyButton";
import { useCopy, useLocale } from "@/components/CopyProvider";
import { accountClient } from "@/components/accountClient";
import { passkeyKind } from "@/shared/passkeys";

type Passkey = { id: string; name?: string | null; aaguid?: string | null; createdAt: string | Date };
const fetchPasskeys = async (): Promise<Passkey[]> => ((await accountClient().passkey.listUserPasskeys()).data as Passkey[] | null) ?? [];

// The account's passkeys: listed, added (this device's WebAuthn) and removed through Better Auth's passkey endpoints.
export function Passkeys() {
  const t = useCopy().account;
  const lang = useLocale();
  const [keys, setKeys] = useState<Passkey[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void fetchPasskeys().then((k) => live && setKeys(k));
    return () => {
      live = false;
    };
  }, []);
  // Adding or removing a passkey needs a sign-in from the last day (Better Auth's check, and notefeed's): a 403 says so.
  const [stale, setStale] = useState(false);
  const [name, setName] = useState("");
  const run = async (step: () => Promise<{ error: { status?: number } | null }>) => {
    setFailed(false);
    setStale(false);
    const { error } = await step();
    if (error?.status === 403) setStale(true);
    else if (error) setFailed(true);
    setKeys(await fetchPasskeys());
  };
  return (
    <div>
      {keys?.length === 0 && <p className="text-sm text-muted">{t.noPasskeys}</p>}
      <ul className="mb-3">
        {keys?.map((k) => (
          <li key={k.id} className="flex items-center justify-between gap-2 py-1">
            <span>
              {k.name && <span className="font-bold">{k.name} · </span>}
              {t.passkeyAdded(passkeyKind(k.aaguid), new Date(k.createdAt).toLocaleDateString(lang))}
            </span>
            <button type="button" onClick={() => run(() => accountClient().passkey.deletePasskey({ id: k.id }))} className="text-sm text-muted underline">
              {t.removePasskey}
            </button>
          </li>
        ))}
      </ul>
      <label htmlFor="passkey-name" className="mb-1 block text-sm text-muted">
        {t.passkeyName}
      </label>
      <div className="flex max-w-sm gap-2">
        <input
          id="passkey-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={50}
          autoComplete="off"
          aria-describedby="passkey-name-hint"
          className="min-w-0 flex-1 rounded-xl border border-rule bg-surface px-3 py-1.5 focus:border-carbon focus:outline-none"
        />
        <button
          type="button"
          onClick={() => run(() => accountClient().passkey.addPasskey(name.trim() ? { name: name.trim() } : undefined)).then(() => setName(""))}
          className="shrink-0 rounded-full bg-surface-2 px-4 py-1.5 font-bold"
        >
          {t.addPasskey}
        </button>
      </div>
      <p id="passkey-name-hint" className="mt-1 text-sm text-muted">
        {t.passkeyNameHint}
      </p>
      <p role="alert" className="mt-2 text-sm text-error">
        {stale ? t.signInAgain : failed ? t.passkeyError : null}
      </p>
    </div>
  );
}

// A new recovery key, shown once; the old one stops working.
export function NewRecoveryKey() {
  const t = useCopy().account;
  const [key, setKey] = useState<string | null>(null);
  const [failed, setFailed] = useState<false | "stale" | "error">(false);
  const make = async () => {
    setFailed(false);
    const res = await fetch("/api/accounts/recovery-key", { method: "POST" }).catch(() => null);
    if (res?.ok) setKey((await res.json()).recoveryKey);
    else setFailed(res?.status === 403 ? "stale" : "error");
  };
  if (key)
    return (
      <div>
        <p className="mb-2 font-bold">{t.newKeyShown}</p>
        <div className="flex items-center gap-2">
          <code className="rounded-lg bg-surface-2 px-3 py-1.5 font-mono text-[15px]">{key}</code>
          <CopyButton text={key} />
        </div>
      </div>
    );
  return (
    <div>
      <p className="mb-2 text-sm text-muted">{t.newKeyIntro}</p>
      <button type="button" onClick={make} className="rounded-full bg-surface-2 px-4 py-1.5 font-bold">
        {t.newKey}
      </button>
      <p role="alert" className="mt-2 text-sm text-error">
        {failed === "stale" ? t.signInAgain : failed ? t.passkeyError : null}
      </p>
    </div>
  );
}
