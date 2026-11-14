"use client";

import { useState } from "react";
import { useCopy } from "@/components/CopyProvider";
import { accountClient } from "@/components/accountClient";

// The login page's passkey button: signs in with a passkey of this device, then goes to `next`.
export function PasskeySignIn({ next }: { next: string }) {
  const t = useCopy().login;
  const [failed, setFailed] = useState(false);
  const signIn = async () => {
    setFailed(false);
    const { error } = await accountClient().signIn.passkey();
    if (error) setFailed(true);
    else window.location.assign(next);
  };
  return (
    <div>
      <button type="button" onClick={signIn} className="rounded-full bg-carbon px-4 py-1.5 font-bold text-on-carbon">
        {t.passkey}
      </button>
      <p role="alert" className="mt-2 text-sm text-error">
        {failed ? t.passkeyFailed : null}
      </p>
    </div>
  );
}
