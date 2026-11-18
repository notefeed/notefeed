"use client";

import Link from "next/link";
import { openCheckout } from "@creem_io/embed";
import { IncludedIcon, NotIncludedIcon, PurchasesIcon } from "@/components/icons";
import { useState, type ReactNode } from "react";
import { messagesFor } from "@/app/_lib/messages";
import { useCopy } from "@/components/CopyProvider";
import type { Copy } from "@/shared/copy";
import { card, primary, secondary } from "@/components/styles";
import { formatPrice, freePrice, saving, type LicenseFeature, type LicenseText, type Plan as Sold } from "@/shared/plans";

async function urlFrom(all: Copy, path: string, body?: unknown): Promise<string> {
  const res = await fetch(path, {
    method: "POST",
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const answer = (await res.json().catch(() => ({}))) as { url?: string; error?: string; code?: string };
  if (res.ok && answer.url) return answer.url;
  throw new Error(
    answer.error && answer.code === "invalid_body"
      ? `${answer.error[0].toUpperCase()}${answer.error.slice(1)}.`
      : (messagesFor(all).errorMessage(answer.code) ?? all.errors.somethingWrong),
  );
}

// The page a buyer lands on (ADR 0029, ADR 0061): the operator's intro, the free tile, a tile per plan the provider sells (ADR 0035):
// its name and price from the provider, the rest from license.md, each with a button that opens the provider's checkout over the page
// for as many feeds as chosen, and license.md's fine print below them. A license belongs to an account: buying needs one signed in
// (`signedIn`; else the page sends you to sign in or create one), and the buyer comes back to the account page, where the license is
// managed. No key: the account is what was bought for.
export function BuyLicense({
  text,
  intro,
  fineprint,
  plans,
  cap,
  signedIn,
}: {
  text: LicenseText;
  intro: ReactNode;
  fineprint?: ReactNode;
  plans: Sold[];
  cap: number;
  signedIn: boolean;
}) {
  const all = useCopy();
  const t = all.buy;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [units, setUnits] = useState(1);

  const month = plans.find((p) => p.period === "month");

  async function buy(period: Sold["period"]) {
    setBusy(true);
    setError("");
    if (!signedIn) return window.location.assign(`/login?next=${encodeURIComponent("/license")}`);
    try {
      const url = await urlFrom(all, "/api/v1/account/license/checkout", { period, units });
      // The fake provider's checkout is this page itself.
      if (new URL(url, window.location.href).origin === window.location.origin) return window.location.assign(url);
      // The provider's checkout opens over this page. Paid, it comes back here with the checkout's id, as its redirect did; the
      // webhook alone decides the license, the overlay is only the screen (#339).
      openCheckout({
        checkoutUrl: url,
        theme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
        onComplete: (done) => done.redirect || window.location.assign("/account?bought=1"),
        onClose: () => setBusy(false),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : all.errors.somethingWrong);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 text-sm">
      {
        <section aria-label={t.buyLabel}>
          {intro && <div className="mb-5 text-[15px] text-muted">{intro}</div>}
          <div className={`grid gap-x-3 ${COLUMNS[plans.length] ?? "sm:grid-cols-3"}`}>
            <section aria-labelledby="plan-free" className={`${tile} max-sm:mb-3`}>
              <h2 id="plan-free" className="text-[15px] font-bold">
                {text.free.title}
              </h2>
              <span />
              <p className="mt-1 text-xl font-bold tracking-tight">{freePrice(text.free.price, plans[0]?.currency)}</p>
              <div>{text.free.note && <p className="text-[13px] text-muted">{text.free.note}</p>}</div>
              <Features t={all} features={text.free.features} cap={cap} className="mt-4" />
              <span />
            </section>
            {plans.map((plan, i) => (
              <Plan
                key={plan.period}
                t={all}
                plan={plan}
                text={text.plans}
                cap={cap}
                badge={(plan.period === "year" && saving(month, plan, t.save)) || text.plans.badge}
                busy={busy}
                onBuy={() => buy(plan.period)}
                primary={i === plans.length - 1}
              />
            ))}
          </div>
          {plans.length === 0 && (
            <p role="status" className="mt-3 text-muted">
              {t.unavailable}
            </p>
          )}
          <p id="buy-error" role="alert" className="mt-2 text-error empty:hidden">
            {error}
          </p>
          <label className="mt-4 flex items-center gap-2 text-muted">
            {t.feeds}
            <input
              type="number"
              min={1}
              max={100}
              value={units}
              onChange={(e) => setUnits(Math.max(1, Math.min(100, Math.trunc(Number(e.target.value)) || 1)))}
              className="w-20 rounded-xl border border-rule bg-surface px-2 py-1"
            />
          </label>
          {!signedIn && <p className="mt-2 text-muted">{t.needsAccount}</p>}
          {fineprint && <div className="mt-3 text-[12px] text-muted">{fineprint}</div>}
        </section>
      }
      <ManageLicense t={all} />
    </div>
  );
}

// Tailwind sees whole class names only: the free tile and one column per plan.
const COLUMNS: Record<number, string> = { 0: "sm:grid-cols-1", 1: "sm:grid-cols-2", 2: "sm:grid-cols-3" };

// Every tile spans the same six rows of the grid and takes them as its own (subgrid): name, badge, price, the line under it,
// the features, the button. A row is as tall as its tallest tile, so a badge or a name that wraps in one tile moves the same row
// in all of them, and prices, features and buttons line up (notefeed/notefeed#223). A tile with nothing for a row leaves it empty.
const tile = `${card} row-span-6 grid grid-rows-subgrid gap-0 p-5`;

// A paid tile: the provider's name and price, what every license adds (license.md), and the button to the checkout. The provider's
// description is for its checkout and receipt, where it can say more than a tile should.
// `primary`: the highlighted one (the last, the yearly plan where one is sold); `badge`: what it saves, or license.md's badge.
function Plan({
  t,
  plan,
  text,
  cap,
  badge,
  busy,
  onBuy,
  primary: highlighted,
}: {
  t: Copy;
  plan: Sold;
  text: LicenseText["plans"];
  cap: number;
  badge?: string;
  busy: boolean;
  onBuy: () => void;
  primary: boolean;
}) {
  const id = `plan-${plan.period}`;
  return (
    <section aria-labelledby={id} className={`${tile} max-sm:mb-3 ${highlighted ? "border-carbon" : ""}`}>
      <h2 id={id} className="text-[15px] font-bold">
        {plan.name}
      </h2>
      <div className="mt-1.5">
        {badge && (
          <span className="inline-block rounded-full bg-carbon-soft px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-carbon">{badge}</span>
        )}
      </div>
      <p className="mt-1 text-xl font-bold tracking-tight">{formatPrice(plan, t.buy.perPeriod)}</p>
      <div>
        {plan.taxIncluded && <p className="text-[13px] text-muted">{t.buy.vatIncluded}</p>}
        {text.note && <p className="mt-2 text-[13px] text-muted">{text.note}</p>}
      </div>
      <Features t={t} features={text.features} cap={cap} className="mb-5 mt-4" />
      <button type="button" disabled={busy} onClick={onBuy} className={`${highlighted ? primary : secondary} w-full self-end py-2.5 text-[15px]`}>
        {text.button}
      </button>
    </section>
  );
}

// `{cap}` in a feature is the free tier's cap as the server keeps it.
function Features({ t, features, cap, className }: { t: Copy; features: LicenseFeature[]; cap: number; className: string }) {
  return (
    <ul className={`${className} space-y-2 text-[14px]`}>
      {features.map((f, i) => (
        <Feature key={i} t={t} off={!f.included}>
          {f.text.replaceAll("{cap}", String(cap))}
        </Feature>
      ))}
    </ul>
  );
}

function Feature({ t, off = false, children }: { t: Copy; off?: boolean; children: ReactNode }) {
  return (
    <li className={`flex items-start gap-2 ${off ? "text-muted" : ""}`}>
      {off ? (
        <NotIncludedIcon aria-label={t.buy.notIncluded} className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <IncludedIcon aria-label={t.buy.included} className="mt-0.5 h-4 w-4 shrink-0 text-carbon" />
      )}
      {children}
    </li>
  );
}

// Managing a license (its units, which feeds, the provider's portal for cancelling, the payment method and invoices) is on the account
// page: the license belongs to the account, so only its holder opens the provider's pages for it (ADR 0061).
function ManageLicense({ t }: { t: Copy }) {
  return (
    <section aria-labelledby="manage" className={`${card} p-5 sm:p-6`}>
      <h2 id="manage" className="flex items-center gap-2 text-[17px] font-bold">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-carbon-soft text-carbon">
          <PurchasesIcon aria-hidden className="h-[18px] w-[18px]" />
        </span>
        {t.buy.manageTitle}
      </h2>
      <p className="mt-3 text-muted">{t.buy.managePurchases}</p>
      <Link href="/account" className={`${secondary} mt-4 inline-flex`}>
        {t.buy.manage}
      </Link>
    </section>
  );
}
