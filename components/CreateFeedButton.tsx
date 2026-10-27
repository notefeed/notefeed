"use client";

import { useState } from "react";
import { secondary } from "@/components/styles";

// "Create feed" in the new feed's card (#295, ADR 0047): makes the feed without a note, with the password and the license key typed
// into the card (their fields belong to the compose box's form). A plain POST to /<feed>/access, which redirects back to the feed,
// unlocked for it when it has a password, or to the card with the reason it was refused.
export function CreateFeedButton({ feed }: { feed: string }) {
  const [busy, setBusy] = useState(false);
  const create = async () => {
    const value = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";
    setBusy(true);
    const body = new URLSearchParams({ action: "create", password: value("new-feed-password"), key: value("new-feed-license-key").trim() });
    const res = await fetch(`/${feed}/access`, { method: "POST", body }).catch(() => null);
    window.location.assign(res?.url ?? `/${feed}?form=create&error=unavailable`);
  };
  return (
    <button type="button" onClick={create} disabled={busy} className={`${secondary} mt-3`}>
      Create feed without a note
    </button>
  );
}
