// Buying and holding a license (ADR 0029): the checkout, the provider's webhook, and entering or detaching a key. The key is the
// provider's: it issues one per purchase, puts it in the buyer's receipt and its customer portal, so a lost key is found there
// again, and hands it to notefeed in the completed checkout. notefeed stores its hash alone; the success page shows the key by
// asking the provider for the checkout the buyer came back from.
import { createHash } from "node:crypto";
import { config } from "./config";
import { InvalidBodyError, LicenseRequiredError, NotFoundError, TooManyAttemptsError, UnknownLicenseKeyError } from "./errors";
import { hasActiveLicense, licenses } from "./licensing";
import { logger } from "./log";
import { licenseEvent } from "./metrics";
import { paymentProvider, WebhookRejectedError, type LicenseEvent, type LicensePeriod } from "./payments";
import { checkFeed } from "./feednames";
import { hasFeed } from "./feeds";
import { authFailed, authWait } from "./limits";

const log = logger("licenses");

export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");
const KEY_RE = /^[A-Za-z0-9_-]{22,64}$/;
const CHECKOUT_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** The URL to send a buyer to, for a license per month or, where one is offered, per year. The buyer comes back to the license
 *  page with the checkout's id. Throws when no provider is configured, or InvalidBodyError for a period that is not sold. */
export async function startCheckout(period: LicensePeriod = "month"): Promise<{ url: string }> {
  const provider = paymentProvider();
  if (!provider) throw new NotFoundError("licenses are not sold on this instance");
  // What the provider sells right now: a product that is not configured, gone or not active has no plan (ADR 0035).
  if (!(await provider.plans()).some((p) => p.period === period)) throw new InvalidBodyError(`no license per ${period} is sold here`);
  return provider.createCheckout({ successUrl: `${config.publicUrl()}/license`, period });
}

/** The key bought in a checkout, for the success page. NotFoundError while the checkout is not completed (the page asks again),
 *  InvalidBodyError for an id that cannot be one. Whoever has the checkout's id may see its key: it is the buyer's redirect. */
export async function keyOfCheckout(checkoutId: string): Promise<{ key: string }> {
  const provider = paymentProvider();
  if (!provider) throw new NotFoundError("licenses are not sold on this instance");
  if (!CHECKOUT_RE.test(checkoutId)) throw new InvalidBodyError("that is not a checkout");
  const key = await provider.checkoutKey(checkoutId);
  if (!key) throw new NotFoundError("no license key for that checkout yet");
  return { key };
}

/** Applies one webhook delivery; the same event twice does no harm. Returns how many events it held. */
export async function receiveWebhook(rawBody: string, headers: Headers): Promise<number> {
  const provider = paymentProvider();
  if (!provider) throw new NotFoundError("licenses are not sold on this instance");
  const events = await provider.parseWebhook(rawBody, headers);
  for (const e of events) {
    await apply(e);
    // The provider keeps charging a refunded subscription unless it is ended there too. The license has lapsed either way, so a
    // failure here (ended already, by the same event delivered before) is logged and not answered with an error.
    if (e.type === "refunded") await provider.cancel(e.providerRef).catch((err) => log.warn({ err }, "a refunded subscription was not cancelled at the provider"));
  }
  return events.length;
}

async function apply(e: LicenseEvent): Promise<void> {
  const store = licenses();
  switch (e.type) {
    case "started":
      await store.createLicense({ keyHash: hashKey(e.key), providerRef: e.providerRef, validUntil: e.validUntil });
      log.info("license bought");
      return licenseEvent("bought");
    case "renewed":
      // A renewal after a lapse (the buyer paid again) makes it active again.
      if (await store.update(e.providerRef, { status: "active", validUntil: e.validUntil })) licenseEvent("renewed");
      return;
    case "cancelled":
      // Stays active to the end of the paid period; hasActiveLicense ends it then.
      await store.update(e.providerRef, { validUntil: e.validUntil });
      return;
    case "ended": {
      // Delivered late, after the payment retried for that period went through: the license already runs on past it.
      const license = await store.byProviderRef(e.providerRef);
      if (e.periodEnd !== null && license?.validUntil != null && license.validUntil > e.periodEnd) return void log.info("a late end of a period that is paid since");
      if (await store.update(e.providerRef, { status: "lapsed" })) licenseEvent("lapsed");
      return void log.info({ why: e.type }, "license lapsed");
    }
    case "refunded":
      if (await store.update(e.providerRef, { status: "lapsed" })) licenseEvent("lapsed");
      return void log.info({ why: e.type }, "license lapsed");
  }
}

/** Before a feed is created protected with this key (issue #193): the key must be one, and its license active, or the feed would
 *  be created with a password it may not have. InvalidBodyError for a key that is none, LicenseRequiredError for a lapsed one. */
export async function checkLicenseKey(key: string): Promise<void> {
  const license = KEY_RE.test(key) ? await licenses().byKeyHash(hashKey(key)) : null;
  if (!license) throw new UnknownLicenseKeyError();
  if (license.status !== "active" || (license.validUntil !== null && license.validUntil <= Date.now())) throw new LicenseRequiredError();
}

/** Enters a key for a feed: UnknownLicenseKeyError for a key that is none, LicenseRequiredError for a lapsed one. The caller has
 *  proved write access to the feed. */
export async function attachLicense(feed: string, key: string): Promise<void> {
  if (checkFeed(feed) || !(await hasFeed(feed))) throw new NotFoundError("no such feed");
  await checkLicenseKey(key); // a lapsed license would give the feed nothing: 402, as on the post that creates a feed (#247)
  let result = await licenses().attach(hashKey(key), feed);
  // A lapsed license stays on its feed (it is the record of the subscription), but it gives the feed nothing: a new key takes its place.
  if (result === "feed-has-license" && !(await hasActiveLicense(feed))) {
    await licenses().detach(feed);
    result = await licenses().attach(hashKey(key), feed);
  }
  if (result === "unknown-key") throw new UnknownLicenseKeyError();
  if (result === "feed-has-license") throw new InvalidBodyError("the feed already has a license; detach it first");
  licenseEvent("attached");
}

/** A key someone sends, from `ip`: a key notefeed doesn't know counts as a failed attempt, as a wrong password does, and over the
 *  limit no key is looked at (TooManyAttemptsError), so keys can't be tried in bulk (#247). */
export async function countingKeys<T>(ip: string, tryKey: () => Promise<T>): Promise<T> {
  const wait = authWait(ip);
  if (wait !== null) throw new TooManyAttemptsError(wait);
  try {
    return await tryKey();
  } catch (e) {
    if (e instanceof UnknownLicenseKeyError) authFailed(ip);
    throw e;
  }
}

export async function detachLicense(feed: string): Promise<void> {
  await licenses().detach(feed);
}

export { WebhookRejectedError };
