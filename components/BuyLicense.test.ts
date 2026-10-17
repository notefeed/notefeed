import { describe, expect, it } from "vitest";
import { saving } from "@/components/BuyLicense";

describe("saving", () => {
  it("is what the yearly price saves against twelve months, rounded down", () => {
    expect(saving("1.99 € per month", "19.90 € per year")).toBe("Save 16 %");
    expect(saving("€2,50 / month", "€25 / year")).toBe("Save 16 %");
    expect(saving("EUR 1.99 per month", "EUR 19.90 per year")).toBe("Save 16 %");
  });
  it("claims nothing without a saving, across currencies or for free text", () => {
    expect(saving("EUR 2 per month", "EUR 24 per year")).toBeUndefined();
    expect(saving("EUR 2 per month", "USD 20 per year")).toBeUndefined();
    expect(saving("two euros a month", "EUR 20 per year")).toBeUndefined();
  });
});
