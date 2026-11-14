"use client";

import { useEffect, useState } from "react";
import { CopyButton } from "@/components/CopyButton";
import { useCopy, useLocale } from "@/components/CopyProvider";
import { accountClient } from "@/components/accountClient";

type Passkey = { id: string; name?: string | null; createdAt: string | Date };
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
  const run = async (step: () => Promise<{ error: unknown }>) => {
    setFailed(false);
    const { error } = await step();
    if (error) setFailed(true);
    setKeys(await fetchPasskeys());
  };
  return (
    <div>
      {keys?.length === 0 && <p className="text-sm text-muted">{t.noPasskeys}</p>}
      <ul className="mb-3">
        {keys?.map((k) => (
          <li key={k.id} className="flex items-center justify-between gap-2 py-1">
            <span>{k.name || t.passkeyAdded(new Date(k.createdAt).toLocaleDateString(lang))}</span>
            <button type="button" onClick={() => run(() => accountClient().passkey.deletePasskey({ id: k.id }))} className="text-sm text-muted underline">
              {t.removePasskey}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => run(() => accountClient().passkey.addPasskey())} className="rounded-full bg-surface-2 px-4 py-1.5 font-bold">
        {t.addPasskey}
      </button>
      <p role="alert" className="mt-2 text-sm text-error">
        {failed ? t.passkeyError : null}
      </p>
    </div>
  );
}

// A new recovery key, shown once; the old one stops working.
export function NewRecoveryKey() {
  const t = useCopy().account;
  const [key, setKey] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const make = async () => {
    setFailed(false);
    const res = await fetch("/api/accounts/recovery-key", { method: "POST" }).catch(() => null);
    if (res?.ok) setKey((await res.json()).recoveryKey);
    else setFailed(true);
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
        {failed ? t.passkeyError : null}
      </p>
    </div>
  );
}
