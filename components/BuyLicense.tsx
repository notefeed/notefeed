"use client";

import { Check, KeyRound, ReceiptText, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { errorMessage } from "@/app/_lib/messages";
import { CopyButton } from "@/components/CopyButton";
import { card, field, primary, secondary } from "@/components/styles";

const KEY = /^[A-Za-z0-9_-]{22,64}$/;

async function urlFrom(path: string, body?: unknown): Promise<string> {
  const res = await fetch(path, { method: "POST", ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
  const answer = (await res.json().catch(() => ({}))) as { url?: string; error?: string; code?: string };
  if (res.ok && answer.url) return answer.url;
  throw new Error(answer.error && answer.code === "invalid_body" ? `${answer.error[0].toUpperCase()}${answer.error.slice(1)}.` : (errorMessage(answer.code) ?? "Something went wrong."));
}

// The page a buyer lands on (ADR 0029). Before paying: what a license is, and a tile per plan next to the free tier: per month and,
// where one is sold, per year, each with a button that opens the provider's checkout.
// After: the key, which is in the fragment of this page's URL, so notefeed's server has not received it; it keeps only the hash and
// cannot show it again. Below both: the way to the provider's page for a license one holds, by its key.
export function BuyLicense({ price, yearlyPrice = "", cap }: { price: string; yearlyPrice?: string; cap: number }) {
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

  async function buy(period: "month" | "year") {
    setBusy(true);
    setError("");
    try {
      window.location.assign(await urlFrom("/api/licenses/checkout", { period }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 text-sm">
      {key ? (
        <section aria-labelledby="your-key" className={`${card} p-5 sm:p-6`}>
          <h2 id="your-key" className="flex items-center gap-2 text-[17px] font-bold">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-carbon-soft text-carbon">
              <KeyRound aria-hidden className="h-[18px] w-[18px]" />
            </span>
            Your license key
          </h2>
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-surface-2 py-2 pl-4 pr-2">
            <code className="min-w-0 flex-1 break-all font-mono text-carbon">{key}</code>
            <CopyButton text={key} />
          </div>
          <p className="mt-4 text-muted">
            Keep this key. notefeed stores no information about you, so it cannot show the key again or recover a lost one. Enter it under <em>License</em> in a
            feed&apos;s settings, or under <em>Protect this feed</em> when you create a protected feed. It works for one feed at a time and can be moved to another.
          </p>
          <p className="mt-2 text-muted">The payment provider&apos;s receipt is the record of your purchase.</p>
        </section>
      ) : (
        <section aria-label="Buy a license">
          <p className="mb-5 text-[15px] text-muted">
            A license lifts the free tier&apos;s limits for one feed. Reading a feed is always free, and there are no accounts: the license is a key you keep.
          </p>
          <div className={`grid gap-3 ${yearlyPrice ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
            <div className={`${card} flex flex-col p-5`}>
              <h2 className="text-[15px] font-bold">Free</h2>
              <p className="mt-1 text-xl font-bold tracking-tight">0</p>
              <p className="text-[13px] text-muted">Every feed starts here.</p>
              <ul className="mt-4 space-y-2 text-[14px]">
                <Feature>The newest {cap} notes are kept</Feature>
                <Feature off>No images</Feature>
                <Feature off>No feed password</Feature>
              </ul>
            </div>
            <Plan title={yearlyPrice ? "Monthly" : "With a license"} price={price} busy={busy} onBuy={() => buy("month")} buyLabel={yearlyPrice ? "Pay monthly" : "Buy a license"} primary={!yearlyPrice} />
            {yearlyPrice && <Plan title="Yearly" price={yearlyPrice} badge={saving(price, yearlyPrice)} busy={busy} onBuy={() => buy("year")} buyLabel="Pay yearly" primary />}
          </div>
          <p id="buy-error" role="alert" className="mt-2 text-error empty:hidden">
            {error}
          </p>
        </section>
      )}
      <ManageLicense bought={key} />
    </div>
  );
}

// A paid tile: the price for one period, what a license adds, and the button to the checkout. `primary`: the highlighted one
// (the yearly plan where one is sold), `badge`: what it saves.
function Plan({ title, price, badge, busy, onBuy, buyLabel, primary: highlighted = false }: { title: string; price: string; badge?: string; busy: boolean; onBuy: () => void; buyLabel: string; primary?: boolean }) {
  return (
    <div className={`${card} flex flex-col p-5 ${highlighted ? "border-carbon" : ""}`}>
      <h2 className="flex flex-wrap items-center gap-2 text-[15px] font-bold">
        {title}
        <span className="rounded-full bg-carbon-soft px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-carbon">{badge ?? "Per feed"}</span>
      </h2>
      <p className="mt-1 text-xl font-bold tracking-tight">{price || "—"}</p>
      <p className="text-[13px] text-muted">For one feed at a time; the key can move.</p>
      <ul className="mb-5 mt-4 space-y-2 text-[14px]">
        <Feature>All notes are kept</Feature>
        <Feature>Images</Feature>
        <Feature>A feed password</Feature>
      </ul>
      <button type="button" disabled={busy} onClick={onBuy} className={`${highlighted ? primary : secondary} mt-auto w-full py-2.5 text-[15px]`}>
        {buyLabel}
      </button>
    </div>
  );
}

// "Save 17 %": what the yearly price saves against twelve months, when both are an amount in the same currency (the prices are the
// operator's free text, NOTEFEED_LICENSE_PRICE and _YEARLY); otherwise nothing is claimed.
export function saving(monthly: string, yearly: string): string | undefined {
  // The currency before the amount ("EUR 1.99", "€1.99") or after it ("1.99 €").
  const amount = (s: string) => {
    const m = s.match(/^\s*(?:([A-Z]{3}|[€$£])\s*(\d+(?:[.,]\d{1,2})?)|(\d+(?:[.,]\d{1,2})?)\s*([A-Z]{3}|[€$£]))/);
    return m && { currency: m[1] ?? m[4], value: Number((m[2] ?? m[3]).replace(",", ".")) };
  };
  const m = amount(monthly);
  const y = amount(yearly);
  if (!m || !y || m.currency !== y.currency) return undefined;
  const percent = Math.floor((1 - y.value / (m.value * 12)) * 100);
  return percent > 0 ? `Save ${percent} %` : undefined;
}

function Feature({ off = false, children }: { off?: boolean; children: ReactNode }) {
  return (
    <li className={`flex items-start gap-2 ${off ? "text-muted" : ""}`}>
      {off ? <X aria-label="Not included:" className="mt-0.5 h-4 w-4 shrink-0" /> : <Check aria-label="Included:" className="mt-0.5 h-4 w-4 shrink-0 text-carbon" />}
      {children}
    </li>
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
    <section aria-labelledby="manage" className={`${card} p-5 sm:p-6`}>
      <h2 id="manage" className="flex items-center gap-2 text-[17px] font-bold">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-carbon-soft text-carbon">
          <ReceiptText aria-hidden className="h-[18px] w-[18px]" />
        </span>
        Cancel, payment and invoices
      </h2>
      <p className="mt-3 text-muted">
        {bought
          ? "The subscription is managed at the payment provider. Come back to this page with your key to cancel it, change how you pay or get an invoice."
          : "The subscription is managed at the payment provider. Enter your license key to cancel it, change how you pay or get an invoice."}
      </p>
      <form
        className="mt-4 flex flex-wrap gap-2"
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
            <input id="manage-key" value={typed} onChange={(e) => setTyped(e.target.value)} required maxLength={64} autoComplete="off" spellCheck={false} aria-describedby="manage-error" placeholder="License key" className={`${field} flex-1 font-mono sm:min-w-64`} />
          </>
        )}
        <button type="submit" disabled={busy} className={secondary}>
          Manage subscription
        </button>
      </form>
      <p id="manage-error" role="alert" className="mt-2 text-error empty:hidden">
        {error}
      </p>
    </section>
  );
}
