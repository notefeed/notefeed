"use client";

import { useState } from "react";
import { CopyButton } from "@/components/CopyButton";
import { useCopy } from "@/components/CopyProvider";

// Creating an account (ADR 0057): the number and the recovery key, shown once, then "I saved them" before going on.
export function CreateAccount({ next }: { next: string }) {
  const t = useCopy().account;
  const [state, setState] = useState<"idle" | "creating" | "failed" | { number: string; recoveryKey: string }>("idle");
  const [saved, setSaved] = useState(false);
  const create = async () => {
    setState("creating");
    const res = await fetch("/api/accounts/create", { method: "POST" }).catch(() => null);
    setState(res?.ok ? await res.json() : "failed");
  };
  if (typeof state === "object")
    return (
      <div className="max-w-md">
        <p className="mb-4 font-bold">{t.saveThem}</p>
        {[
          [t.number, state.number],
          [t.recoveryKey, state.recoveryKey],
        ].map(([label, value]) => (
          <div key={label} className="mb-4">
            <p className="mb-1 text-sm text-muted">{label}</p>
            <div className="flex items-center gap-2">
              <code className="rounded-lg bg-surface-2 px-3 py-1.5 font-mono text-[15px]">{value}</code>
              <CopyButton text={value} />
            </div>
          </div>
        ))}
        <label className="mb-4 flex items-center gap-2">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          {t.saved}
        </label>
        <a
          href={next}
          aria-disabled={!saved}
          onClick={(e) => (saved ? undefined : e.preventDefault())}
          className={`inline-block rounded-full px-4 py-1.5 font-bold ${saved ? "bg-carbon text-on-carbon" : "pointer-events-none bg-surface-2 text-muted"}`}
        >
          {t.continue}
        </a>
      </div>
    );
  return (
    <div className="max-w-md">
      <button type="button" onClick={create} disabled={state === "creating"} className="rounded-full bg-carbon px-4 py-1.5 font-bold text-on-carbon">
        {state === "creating" ? t.creating : t.create}
      </button>
      <p role="alert" className="mt-2 text-sm text-error">
        {state === "failed" ? t.failed : null}
      </p>
    </div>
  );
}
