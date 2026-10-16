// The provider this instance uses, from NOTEFEED_PAYMENT_PROVIDER; null while none is set (licensing is off then).
import { config } from "../config";
import { createCreem } from "./creem";
import { createFake } from "./fake";
import type { PaymentProvider } from "./types";

export type { LicenseEvent, LicensePeriod, PaymentProvider } from "./types";
export { WebhookRejectedError } from "./types";

export function paymentProvider(): PaymentProvider | null {
  switch (config.paymentProvider()) {
    case "":
      return null;
    case "fake":
      return createFake(config.fakeWebhookSecret());
    case "creem":
      return createCreem(config.creem());
    default:
      throw new Error("unknown NOTEFEED_PAYMENT_PROVIDER"); // config.validateStorage refuses it at start
  }
}
