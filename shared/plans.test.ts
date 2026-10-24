import { expect, test } from "vitest";
import { formatPrice, freePrice, saving, type LicensePeriod, type Plan } from "./plans";

const p = (period: LicensePeriod, amount: number, currency = "EUR"): Plan => ({ period, name: "", description: "", amount, currency, taxIncluded: true });

test("formatPrice: minor units by the currency's own digits", () => {
  expect(formatPrice(p("month", 199))).toBe("€1.99 per month");
  expect(formatPrice(p("year", 1990))).toBe("€19.90 per year");
  expect(formatPrice(p("year", 500, "JPY"))).toBe("¥500 per year");
  expect(formatPrice(p("month", 1990, "USD"))).toBe("$19.90 per month");
});

test("saving: against twelve months, rounded down", () => {
  expect(saving(p("month", 199), p("year", 1990))).toBe("Save 16 %");
});

test("saving: nothing without a saving, across currencies, or without both", () => {
  expect(saving(p("month", 200), p("year", 2400))).toBeUndefined();
  expect(saving(p("month", 200), p("year", 2600))).toBeUndefined();
  expect(saving(p("month", 200), p("year", 2000, "USD"))).toBeUndefined();
  expect(saving(p("month", 199), undefined)).toBeUndefined();
  expect(saving(undefined, p("year", 1990))).toBeUndefined();
});

test("the free tile's price: a bare number in the plans' currency, like theirs; anything else as written", () => {
  expect(freePrice("0", "EUR")).toBe("€0");
  expect(freePrice("0.50", "EUR")).toBe("€0.50");
  expect(freePrice("0", "USD")).toBe("$0");
  expect(freePrice("Free", "EUR")).toBe("Free");
  expect(freePrice("0", undefined)).toBe("0"); // no plan sold: no currency to put on it
});
