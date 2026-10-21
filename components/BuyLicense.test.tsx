import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { BuyLicense } from "@/components/BuyLicense";
import type { LicenseText, Plan } from "@/shared/plans";

// What backend/licensepage.fixture.ts parses to.
const text: LicenseText = {
  free: {
    title: "Free",
    price: "0",
    note: "Every feed starts here.",
    features: [
      { text: "The newest {cap} notes are kept", included: true },
      { text: "No images", included: false },
      { text: "No feed password", included: false },
    ],
  },
  plans: {
    badge: "Per feed",
    note: "For one feed at a time; the key can move.",
    features: [
      { text: "All notes are kept", included: true },
      { text: "Images", included: true },
      { text: "A feed password", included: true },
    ],
    button: "Subscribe",
  },
  intro: "A license lifts the free tier's limits for one feed.",
  fineprint: "A subscription renews until you cancel it. See the [terms](/terms).",
};
const month: Plan = { period: "month", name: "Monthly", description: "Line one\nLine two", amount: 199, currency: "EUR", taxIncluded: true };
const year: Plan = { ...month, period: "year", name: "Yearly", description: "", amount: 1990 };
const render = (plans: Plan[], cap = 1000) => renderToStaticMarkup(<BuyLicense text={text} intro={<p>The intro</p>} fineprint={<p>The fine print</p>} plans={plans} cap={cap} />);

test("a tile per plan with the provider's name, price and description, the words from license.md", () => {
  const html = render([month, year]);
  for (const s of ["The intro", "Free", "Every feed starts here.", "Monthly", "Yearly", "€1.99 per month", "€19.90 per year", "Save 16 %", "Per feed", "VAT included", "Line one\nLine two", "For one feed at a time; the key can move.", "A feed password"])
    expect(html).toContain(s);
  expect(html.match(/>Subscribe</g)).toHaveLength(2);
  expect(html).toContain("sm:grid-cols-3");
  expect(html).toContain('aria-labelledby="plan-year"');
});

test("the fine print comes after the tiles", () => {
  const html = render([month, year]);
  expect(html.indexOf("The fine print")).toBeGreaterThan(html.lastIndexOf(">Subscribe<"));
});

test("{cap} is the configured cap, and a feature can be crossed out", () => {
  const html = render([month], 10);
  expect(html).toContain("The newest 10 notes are kept");
  expect(html.match(/aria-label="Not included:"/g)).toHaveLength(2);
});

test("one plan: two columns, the badge from license.md, no saving", () => {
  const html = render([month]);
  expect(html).toContain("sm:grid-cols-2");
  expect(html).toContain("Per feed");
  expect(html).not.toContain("Save");
});

test("no plans: no buy button, and a line that licenses can't be bought now", () => {
  const html = render([]);
  expect(html).not.toContain(">Subscribe<");
  expect(html).toContain("Licenses can&#x27;t be bought right now. Please try again later.");
  expect(html).toContain("The newest 1000 notes are kept");
});

test("no tax included: no VAT line", () => {
  expect(render([{ ...month, taxIncluded: false }])).not.toContain("VAT included");
});
