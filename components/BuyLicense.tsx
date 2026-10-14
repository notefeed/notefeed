"use client";

import { KeyRound, ReceiptText } from "lucide-react";
import { useEffect, useState } from "react";
import { errorMessage } from "@/app/_lib/messages";
import { CopyButton } from "@/components/CopyButton";

const KEY = /^[A-Za-z0-9_-]{22,64}$/;
const input = "min-w-0 flex-1 rounded-xl border border-rule bg-surface px-3 py-1.5 font-mono focus:border-carbon focus:outline-none";

async function urlFrom(path: string, body?: unknown): Promise<string> {
  const res = await fetch(path, { method: "POST", ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
  const answer = (await res.json().catch(() => ({}))) as { url?: string; error?: string; code?: string };
  if (res.ok && answer.url) return answer.url;
  throw new Error(answer.error && answer.code === "invalid_body" ? `${answer.error[0].toUpperCase()}${answer.error.slice(1)}.` : (errorMessage(answer.code) ?? "Something went wrong."));
}

// The page a buyer lands on (ADR 0029). Before paying: what a license is, its price, and a button that opens the provider's checkout.
// After: the key, which is in the fragment of this page's URL, so notefeed's server has not received it; it keeps only the hash and
// cannot show it again. Below both: the way to the provider's page for a license one holds, by its key.
export function BuyLicense({ price, cap }: { price: string; cap: number }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // A hash is set after the first render; the state follows it. A checkout that comes straight back to this page changes the hash alone.
    const read = () => {
      const k = window.location.hash.slice(1);
      if (KEY.test(k)) setKey(k);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  async function buy() {
    setBusy(true);
    setError("");
    try {
      window.location.assign(await urlFrom("/api/licenses/checkout"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl text-sm">
      {key ? (
        <section aria-labelledby="your-key">
          <h2 id="your-key" className="mb-3 flex items-center gap-2 text-base font-bold">
            <KeyRound aria-hidden className="h-4 w-4" />
            Your license key
          </h2>
          <div className="flex items-center gap-3">
            <code className="min-w-0 break-all font-mono text-carbon">{key}</code>
            <CopyButton text={key} />
          </div>
          <p className="mt-3 text-muted">
            Keep this key. notefeed stores no information about you, so it cannot show the key again or recover a lost one. Enter it under <em>License</em> in a
            feed&apos;s settings. It works for one feed at a time and can be moved to another.
          </p>
          <p className="mt-2 text-muted">The payment provider&apos;s receipt is the record of your purchase.</p>
        </section>
      ) : (
        <section aria-label="Buy a license">
          <p className="text-muted">
            A license lifts the free tier&apos;s limits for one feed. Reading a feed is always free, and there are no accounts: the license is a key you keep.
          </p>
          <table className="my-4 w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-rule">
                <th className="py-1.5 pr-4 font-bold"></th>
                <th className="py-1.5 pr-4 font-bold">Free</th>
                <th className="py-1.5 font-bold">With a license</th>
              </tr>
            </thead>
            <tbody className="text-muted">
              <tr className="border-b border-rule">
                <th className="py-1.5 pr-4 font-normal text-ink">Notes kept</th>
                <td className="py-1.5 pr-4">the newest {cap}</td>
                <td className="py-1.5">all</td>
              </tr>
              <tr className="border-b border-rule">
                <th className="py-1.5 pr-4 font-normal text-ink">Images</th>
                <td className="py-1.5 pr-4">no</td>
                <td className="py-1.5">yes</td>
              </tr>
              <tr className="border-b border-rule">
                <th className="py-1.5 pr-4 font-normal text-ink">Feed password</th>
                <td className="py-1.5 pr-4">no</td>
                <td className="py-1.5">yes</td>
              </tr>
              {price && (
                <tr>
                  <th className="py-1.5 pr-4 font-normal text-ink">Price</th>
                  <td className="py-1.5 pr-4">free</td>
                  <td className="py-1.5 font-bold text-ink">{price}, per feed</td>
                </tr>
              )}
            </tbody>
          </table>
          <button type="button" disabled={busy} onClick={buy} className="rounded-full bg-carbon px-4 py-1.5 font-bold text-on-carbon disabled:opacity-60">
            Buy a license
          </button>
          <p id="buy-error" role="alert" className="mt-2 text-error">
            {error}
          </p>
        </section>
      )}
      <ManageLicense bought={key} />
    </div>
  );
}

// Cancelling, the payment method and the invoices are the payment provider's pages. The key opens them: whoever holds it bought the license.
function ManageLicense({ bought }: { bought: string }) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function open() {
    setBusy(true);
    setError("");
    try {
      window.location.assign(await urlFrom("/api/licenses/portal", { key: (bought || typed).trim() }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="manage" className="mt-10 border-t border-rule pt-6">
      <h2 id="manage" className="mb-3 flex items-center gap-2 text-base font-bold">
        <ReceiptText aria-hidden className="h-4 w-4" />
        Cancel, payment and invoices
      </h2>
      <p className="text-muted">
        {bought
          ? "The subscription is managed at the payment provider. Come back to this page with your key to cancel it, change how you pay or get an invoice."
          : "The subscription is managed at the payment provider. Enter your license key to cancel it, change how you pay or get an invoice."}
      </p>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void open();
        }}
      >
        {!bought && (
          <>
            <label htmlFor="manage-key" className="sr-only">
              License key
            </label>
            <input id="manage-key" value={typed} onChange={(e) => setTyped(e.target.value)} required maxLength={64} autoComplete="off" spellCheck={false} aria-describedby="manage-error" className={input} />
          </>
        )}
        <button type="submit" disabled={busy} className="rounded-full border border-rule px-4 py-1.5 hover:border-carbon disabled:opacity-60">
          Manage subscription
        </button>
      </form>
      <p id="manage-error" role="alert" className="mt-2 text-error">
        {error}
      </p>
    </section>
  );
}
