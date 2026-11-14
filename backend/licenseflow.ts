// Buying and holding a license on an account (ADR 0061, #391): the checkout for some units, the provider's webhook turned into the
// account's subscriptions, raising and lowering the units, the provider's customer portal, and ending them with the account. No
// license key: the account is the proof (it is what the checkout was for), so the provider's pages open to the account alone.
import { config } from "./config";
import { InvalidBodyError, NotFoundError } from "./errors";
import { logger } from "./log";
import { licenseEvent } from "./metrics";
import { paymentProvider, WebhookRejectedError, type LicenseEvent, type LicensePeriod } from "./payments";
import {
  activeUnits,
  deleteSubscriptionsOf,
  isActive,
  putSubscription,
  subscriptionByRef,
  subscriptionsOf,
  updateSubscription,
} from "./accounts/subscriptions";

const log = logger("licenses");
export const MAX_UNITS = 100;

function provider() {
  const p = paymentProvider();
  if (!p) throw new NotFoundError("licenses are not sold on this instance");
  return p;
}

function checkUnits(units: number): void {
  if (!Number.isInteger(units) || units < 1 || units > MAX_UNITS) throw new InvalidBodyError(`units must be a whole number from 1 to ${MAX_UNITS}`);
}

/** The URL to send the account's holder to, for `units` feeds per month or, where one is offered, per year. The buyer comes back to the
 *  account page. InvalidBodyError for a period that is not sold, or units outside 1 to 100. */
export async function startCheckout(account: string, period: LicensePeriod = "month", units = 1): Promise<{ url: string }> {
  const p = provider();
  checkUnits(units);
  // What the provider sells right now: a product that is not configured, gone or not active has no plan (ADR 0035).
  if (!(await p.plans()).some((plan) => plan.period === period)) throw new InvalidBodyError(`no license per ${period} is sold here`);
  return p.createCheckout({ successUrl: `${config.publicUrl()}/account?bought=1`, period, units, account });
}

/** Applies one webhook delivery; the same event twice does no harm. Returns how many events it held. */
export async function receiveWebhook(rawBody: string, headers: Headers): Promise<number> {
  const p = provider();
  const events = await p.parseWebhook(rawBody, headers);
  for (const e of events) {
    await apply(e);
    // The provider keeps charging a refunded subscription unless it is ended there too. The license has lapsed either way, so a
    // failure here (ended already, by the same event delivered before) is logged and not answered with an error.
    if (e.type === "refunded" && e.full)
      await p.cancel(e.providerRef).catch((err) => log.warn({ err }, "a refunded subscription was not cancelled at the provider"));
  }
  return events.length;
}

async function apply(e: LicenseEvent): Promise<void> {
  switch (e.type) {
    case "started":
      await putSubscription({
        providerRef: e.providerRef,
        account: e.account,
        customerRef: e.customerRef,
        period: e.period,
        units: e.units,
        validUntil: e.validUntil,
      });
      log.info({ units: e.units }, "license bought"); // never for whom
      return licenseEvent("bought");
    case "renewed":
      // A renewal after a lapse (the buyer paid again) makes it active again.
      if (await updateSubscription(e.providerRef, { status: "active", validUntil: e.validUntil, ...(e.units ? { units: e.units } : {}) }))
        licenseEvent("renewed");
      return;
    case "cancelled":
      // Stays active to the end of the paid period; isActive ends it then.
      await updateSubscription(e.providerRef, { validUntil: e.validUntil });
      return;
    case "ended": {
      // Delivered late, after the payment retried for that period went through: the subscription already runs on past it.
      const s = await subscriptionByRef(e.providerRef);
      if (e.periodEnd !== null && s?.validUntil != null && s.validUntil > e.periodEnd) return void log.info("a late end of a period that is paid since");
      if (await updateSubscription(e.providerRef, { status: "lapsed" })) licenseEvent("lapsed");
      return void log.info({ why: e.type }, "license lapsed");
    }
    case "refunded": {
      if (e.full) {
        if (await updateSubscription(e.providerRef, { status: "lapsed" })) licenseEvent("lapsed");
        return void log.info({ why: e.type }, "license lapsed");
      }
      // Part of it: as many units as the provider now says.
      const now = await provider().subscription(e.providerRef);
      if (now) await updateSubscription(e.providerRef, { units: now.units, validUntil: now.validUntil, status: now.active ? "active" : "lapsed" });
      return void log.info("a partial refund: the license's units are the provider's again");
    }
  }
}

/** The account's license: its subscriptions (active ones count), how many feeds they cover, the feeds put under it and those it covers. */
export async function licenseOf(account: string) {
  const { coveredFeeds } = await import("./feedlock");
  const { licensedFeedsOf } = await import("./licensing");
  const subs = await subscriptionsOf(account);
  return {
    subscriptions: subs.map((s) => ({ id: s.providerRef, period: s.period, units: s.units, valid_until: s.validUntil, active: isActive(s) })),
    units: await activeUnits(account),
    covered: await coveredFeeds(account),
    licensed: await licensedFeedsOf(account),
  };
}

/** Changes one of the account's subscriptions to `units`: raising charges the difference now, lowering takes effect without a refund
 *  and goes no lower than the feeds under the license (take one off first, so notefeed never guesses which loses its cover). */
export async function changeUnits(account: string, providerRef: string, units: number): Promise<void> {
  checkUnits(units);
  const s = await subscriptionByRef(providerRef);
  if (!s || s.account !== account || !isActive(s)) throw new NotFoundError("no such subscription on this account");
  if (units === s.units) return;
  const { coveredFeeds } = await import("./feedlock");
  const after = (await activeUnits(account)) - s.units + units;
  const covered = (await coveredFeeds(account)).length;
  if (after < covered) throw new InvalidBodyError(`${covered} feeds are under the license: take ${covered - after} off it first`);
  await provider().changeUnits(providerRef, units, units > s.units ? "raise" : "lower");
  await updateSubscription(providerRef, { units });
  log.info({ how: units > s.units ? "raised" : "lowered" }, "license units changed");
}

/** The provider's customer portal for the account (cancelling, the payment method, invoices): only for the account that bought. */
export async function portalOf(account: string): Promise<{ url: string }> {
  const customer = (await subscriptionsOf(account)).find((s) => s.customerRef)?.customerRef;
  if (!customer) throw new NotFoundError("this account has bought no license");
  return { url: await provider().portalUrl(customer) };
}

/** The operator's (/api/operator/subscriptions): puts a subscription the provider already has on the account, read from the provider. */
export async function attachSubscription(account: string, providerRef: string): Promise<void> {
  const now = await provider().subscription(providerRef);
  if (!now) throw new NotFoundError("the provider has no such subscription");
  const s = await subscriptionByRef(providerRef);
  if (s && s.account !== account) throw new InvalidBodyError("that subscription is on another account");
  await putSubscription({
    providerRef,
    account,
    customerRef: now.customerRef,
    period: now.period,
    units: now.units,
    validUntil: now.validUntil,
    status: now.active ? "active" : "lapsed",
  });
  licenseEvent("attached");
}

/** Deleting an account: its subscriptions end at the provider, so it is not charged again, and their rows go. */
export async function endSubscriptionsOf(account: string): Promise<void> {
  const p = paymentProvider();
  for (const s of await subscriptionsOf(account))
    if (p && isActive(s)) await p.cancel(s.providerRef).catch((err) => log.warn({ err }, "a subscription was not cancelled at the provider"));
  await deleteSubscriptionsOf(account);
}

export { WebhookRejectedError };
