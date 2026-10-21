// What a license page shows (ADR 0035): the plans as the payment provider sells them, and the operator's words around them
// from license.md. Shared, as the page renders them in the browser and the server reads them.

/** How long a license is bought for at a time: the two products the operator may offer (a yearly one only if configured). */
export type LicensePeriod = "month" | "year";

/** A product the provider sells, as it holds it. `amount` is in the currency's minor unit (cents). */
export type Plan = { period: LicensePeriod; name: string; description: string; amount: number; currency: string; taxIncluded: boolean };

export type LicenseFeature = { text: string; included: boolean };

/** license.md: the free tile, what every plan tile shows besides the provider's name and price, the intro (Markdown, "" for none) and the fine print below the tiles (Markdown). */
export type LicenseText = {
  free: { title: string; price: string; note?: string; features: LicenseFeature[] };
  plans: { badge?: string; note?: string; features: LicenseFeature[]; button: string };
  intro: string;
  fineprint?: string;
};

/** "€1.99 per month": the amount in major units, by the currency's own number of digits. */
export function formatPrice({ amount, currency, period }: Pick<Plan, "amount" | "currency" | "period">): string {
  const format = new Intl.NumberFormat("en", { style: "currency", currency });
  return `${format.format(amount / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2))} per ${period}`;
}

/** "Save 16 %": what the yearly plan saves against twelve months, when both are sold in the same currency; otherwise nothing is claimed. */
export function saving(monthly: Plan | undefined, yearly: Plan | undefined): string | undefined {
  if (!monthly || !yearly || monthly.currency !== yearly.currency || monthly.amount <= 0) return undefined;
  const percent = Math.floor((1 - yearly.amount / (12 * monthly.amount)) * 100);
  return percent > 0 ? `Save ${percent} %` : undefined;
}
