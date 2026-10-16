// Buying and holding a license (ADR 0029): the checkout, the provider's webhook, and entering or detaching a key. The key is 128
// random bits made here; the provider carries only its hash through the checkout, so the buyer sees the key on the success page
// (in the URL fragment, which the browser does not send to notefeed) and notefeed stores the hash alone. The provider does hold the
// key: the success URL is given to it whole, and Creem returns it in `checkout.completed`.
import { createHash, randomBytes } from "node:crypto";
import { config } from "./config";
import { InvalidBodyError, NotFoundError } from "./errors";
import { licenses, yearlyLicenseOn } from "./licensing";
import { logger } from "./log";
import { paymentProvider, WebhookRejectedError, type LicenseEvent, type LicensePeriod } from "./payments";
import { checkFeed } from "./feednames";
import { hasFeed } from "./feeds";

const log = logger("licenses");

export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");
const KEY_RE = /^[A-Za-z0-9_-]{22,64}$/;

/** The URL to send a buyer to, for a license per month or, where one is offered, per year. The success page gets the key in its
 *  fragment. Throws when no provider is configured, or InvalidBodyError for a period that is not sold. */
export async function startCheckout(period: LicensePeriod = "month"): Promise<{ url: string }> {
  const provider = paymentProvider();
  if (!provider) throw new NotFoundError("licenses are not sold on this instance");
  if (period === "year" && !yearlyLicenseOn()) throw new InvalidBodyError("no yearly license is sold here");
  const key = randomBytes(16).toString("base64url");
  return provider.createCheckout({ keyHash: hashKey(key), successUrl: `${config.publicUrl()}/license#${key}`, period });
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

/** The provider's page for whoever holds the key: cancelling, the payment method, the invoices. The key is the proof; a feed's name is not. */
export async function portalFor(key: string): Promise<{ url: string }> {
  const provider = paymentProvider();
  if (!provider) throw new NotFoundError("licenses are not sold on this instance");
  const license = KEY_RE.test(key) ? await licenses().byKeyHash(hashKey(key)) : null;
  if (!license?.providerRef) throw new InvalidBodyError("that is not a license key");
  return provider.portalUrl(license.providerRef);
}

async function apply(e: LicenseEvent): Promise<void> {
  const store = licenses();
  switch (e.type) {
    case "started":
      await store.createLicense({ keyHash: e.keyHash, providerRef: e.providerRef, validUntil: e.validUntil });
      return void log.info("license bought");
    case "renewed":
      // A renewal after a lapse (the buyer paid again) makes it active again.
      await store.update(e.providerRef, { status: "active", validUntil: e.validUntil });
      return;
    case "cancelled":
      // Stays active to the end of the paid period; isLicensed ends it then.
      await store.update(e.providerRef, { validUntil: e.validUntil });
      return;
    case "ended":
    case "refunded":
      await store.update(e.providerRef, { status: "lapsed" });
      return void log.info({ why: e.type }, "license lapsed");
  }
}

/** Enters a key for a feed. The caller has proved write access to the feed. */
export async function attachLicense(feed: string, key: string): Promise<void> {
  if (checkFeed(feed) || !(await hasFeed(feed))) throw new NotFoundError("no such feed");
  if (!KEY_RE.test(key)) throw new InvalidBodyError("that is not a license key");
  const result = await licenses().attach(hashKey(key), feed);
  if (result === "unknown-key") throw new InvalidBodyError("that is not a license key");
  if (result === "feed-has-license") throw new InvalidBodyError("the feed already has a license; detach it first");
}

export async function detachLicense(feed: string): Promise<void> {
  await licenses().detach(feed);
}

export { WebhookRejectedError };
