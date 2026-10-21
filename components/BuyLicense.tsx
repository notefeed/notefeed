"use client";

import { Check, KeyRound, ReceiptText, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { errorMessage } from "@/app/_lib/messages";
import { CopyButton } from "@/components/CopyButton";
import { card, field, primary, secondary } from "@/components/styles";
import { formatPrice, saving, type LicenseFeature, type LicenseText, type Plan as Sold } from "@/shared/plans";

const KEY = /^[A-Za-z0-9_-]{22,64}$/;

async function urlFrom(path: string, body?: unknown): Promise<string> {
  const res = await fetch(path, { method: "POST", ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
  const answer = (await res.json().catch(() => ({}))) as { url?: string; error?: string; code?: string };
  if (res.ok && answer.url) return answer.url;
  throw new Error(answer.error && answer.code === "invalid_body" ? `${answer.error[0].toUpperCase()}${answer.error.slice(1)}.` : (errorMessage(answer.code) ?? "Something went wrong."));
}

// The page a buyer lands on (ADR 0029). Before paying: the operator's intro, the free tile, a tile per plan the provider sells
// (ADR 0035): its name, price and description from the provider, the rest from license.md, each with a button that opens the
// provider's checkout, and license.md's fine print below them. After: the key, which is in the fragment of this page's URL, so notefeed's server has not received it; it
// keeps only the hash and cannot show it again. Below both: the way to the provider's page for a license one holds, by its key.
export function BuyLicense({ text, intro, fineprint, plans, cap }: { text: LicenseText; intro: ReactNode; fineprint?: ReactNode; plans: Sold[]; cap: number }) {
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

  const month = plans.find((p) => p.period === "month");

  async function buy(period: Sold["period"]) {
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
          {intro && <div className="mb-5 text-[15px] text-muted">{intro}</div>}
          <div className={`grid gap-3 ${COLUMNS[plans.length] ?? "sm:grid-cols-3"}`}>
            <section aria-labelledby="plan-free" className={`${card} flex flex-col p-5`}>
              <h2 id="plan-free" className="text-[15px] font-bold">
                {text.free.title}
              </h2>
              <p className="mt-1 text-xl font-bold tracking-tight">{text.free.price}</p>
              {text.free.note && <p className="text-[13px] text-muted">{text.free.note}</p>}
              <Features features={text.free.features} cap={cap} className="mt-4" />
            </section>
            {plans.map((plan, i) => (
              <Plan
                key={plan.period}
                plan={plan}
                text={text.plans}
                cap={cap}
                badge={(plan.period === "year" && saving(month, plan)) || text.plans.badge}
                busy={busy}
                onBuy={() => buy(plan.period)}
                primary={i === plans.length - 1}
              />
            ))}
          </div>
          {plans.length === 0 && (
            <p role="status" className="mt-3 text-muted">
              Licenses can&apos;t be bought right now. Please try again later.
            </p>
          )}
          <p id="buy-error" role="alert" className="mt-2 text-error empty:hidden">
            {error}
          </p>
          {fineprint && <div className="mt-3 text-[12px] text-muted">{fineprint}</div>}
        </section>
      )}
      <ManageLicense bought={key} />
    </div>
  );
}

// Tailwind sees whole class names only: the free tile and one column per plan.
const COLUMNS: Record<number, string> = { 0: "sm:grid-cols-1", 1: "sm:grid-cols-2", 2: "sm:grid-cols-3" };

// A paid tile: the provider's name, price and description, what every license adds (license.md), and the button to the checkout.
// `primary`: the highlighted one (the last, the yearly plan where one is sold); `badge`: what it saves, or license.md's badge.
function Plan({ plan, text, cap, badge, busy, onBuy, primary: highlighted }: { plan: Sold; text: LicenseText["plans"]; cap: number; badge?: string; busy: boolean; onBuy: () => void; primary: boolean }) {
  const id = `plan-${plan.period}`;
  return (
    <section aria-labelledby={id} className={`${card} flex flex-col p-5 ${highlighted ? "border-carbon" : ""}`}>
      <h2 id={id} className="flex flex-wrap items-center gap-2 text-[15px] font-bold">
        {plan.name}
        {badge && <span className="rounded-full bg-carbon-soft px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-carbon">{badge}</span>}
      </h2>
      <p className="mt-1 text-xl font-bold tracking-tight">{formatPrice(plan)}</p>
      {plan.taxIncluded && <p className="text-[13px] text-muted">VAT included</p>}
      {/* The provider's text as written: plain, with its line breaks. */}
      {plan.description && <p className="mt-2 whitespace-pre-line text-[13px] text-muted">{plan.description}</p>}
      {text.note && <p className="mt-2 text-[13px] text-muted">{text.note}</p>}
      <Features features={text.features} cap={cap} className="mb-5 mt-4" />
      <button type="button" disabled={busy} onClick={onBuy} className={`${highlighted ? primary : secondary} mt-auto w-full py-2.5 text-[15px]`}>
        {text.button}
      </button>
    </section>
  );
}

// `{cap}` in a feature is the free tier's cap as the server keeps it.
function Features({ features, cap, className }: { features: LicenseFeature[]; cap: number; className: string }) {
  return (
    <ul className={`${className} space-y-2 text-[14px]`}>
      {features.map((f, i) => (
        <Feature key={i} off={!f.included}>
          {f.text.replaceAll("{cap}", String(cap))}
        </Feature>
      ))}
    </ul>
  );
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
