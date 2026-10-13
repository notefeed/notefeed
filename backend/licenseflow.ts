// Buying and holding a license (ADR 0029): the checkout, the provider's webhook, and entering or detaching a key. The key is 128
// random bits made here; the provider carries only its hash through the checkout, so the buyer sees the key on the success page
// (in the URL fragment, which no server receives) and notefeed stores the hash alone.
import { createHash, randomBytes } from "node:crypto";
import { config } from "./config";
import { InvalidBodyError, NotFoundError } from "./errors";
import { licenses } from "./licensing";
import { logger } from "./log";
import { paymentProvider, WebhookRejectedError, type LicenseEvent } from "./payments";
import { checkFeed } from "./feednames";
import { hasFeed } from "./feeds";

const log = logger("licenses");

export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");
const KEY_RE = /^[A-Za-z0-9_-]{22,64}$/;

/** The URL to send a buyer to. The success page gets the key in its fragment. Throws when no provider is configured. */
export async function startCheckout(): Promise<{ url: string }> {
  const provider = paymentProvider();
  if (!provider) throw new NotFoundError("licenses are not sold on this instance");
  const key = randomBytes(16).toString("base64url");
  return provider.createCheckout({ keyHash: hashKey(key), successUrl: `${config.publicUrl()}/license#${key}` });
}

/** Applies one webhook delivery; the same event twice does no harm. Returns how many events it held. */
export async function receiveWebhook(rawBody: string, headers: Headers): Promise<number> {
  const provider = paymentProvider();
  if (!provider) throw new NotFoundError("licenses are not sold on this instance");
  const events = await provider.parseWebhook(rawBody, headers);
  for (const e of events) await apply(e);
  return events.length;
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
  if (result === "no-feed") throw new NotFoundError("no such feed");
}

export async function detachLicense(feed: string): Promise<void> {
  await licenses().detach(feed);
}

export { WebhookRejectedError };
