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

/** An amount as the page shows it: English digits, and the euro sign after the amount, as the euro countries write it
 *  ("1.99 €", #223); any other currency as English writes it ("$1.99"). A no-break space keeps the sign with its amount. */
function money(format: Intl.NumberFormat, value: number): string {
  if (format.resolvedOptions().currency !== "EUR") return format.format(value);
  const amount = format.formatToParts(value).filter((p) => p.type !== "currency").map((p) => p.value).join("").trim();
  return `${amount}\u00a0€`;
}

/** "1.99 € per month": the amount in major units, by the currency's own number of digits. */
export function formatPrice({ amount, currency, period }: Pick<Plan, "amount" | "currency" | "period">): string {
  const format = new Intl.NumberFormat("en", { style: "currency", currency });
  return `${money(format, amount / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2))} per ${period}`;
}

/** The free tile's price from license.md: a bare number gets the plans' currency the way their prices show it ("0 €", "0.50 €"),
 *  so the tiles read alike; anything else ("Free") stays as the operator wrote it, as does any price while no plan gives a currency. */
export function freePrice(price: string, currency: string | undefined): string {
  if (!currency || !/^\d+(\.\d+)?$/.test(price)) return price;
  const digits = price.split(".")[1]?.length ?? 0;
  return money(new Intl.NumberFormat("en", { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }), Number(price));
}

/** "Save 16 %": what the yearly plan saves against twelve months, when both are sold in the same currency; otherwise nothing is claimed. */
export function saving(monthly: Plan | undefined, yearly: Plan | undefined): string | undefined {
  if (!monthly || !yearly || monthly.currency !== yearly.currency || monthly.amount <= 0) return undefined;
  const percent = Math.floor((1 - yearly.amount / (12 * monthly.amount)) * 100);
  return percent > 0 ? `Save ${percent} %` : undefined;
}
