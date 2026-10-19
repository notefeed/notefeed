import { expect, test } from "vitest";
import { parseLicensePage } from "./licensepage";
import { VALID_LICENSE as VALID } from "./licensepage.fixture";

test("the spec's example parses; included defaults to true; the body is the intro", () => {
  const t = parseLicensePage(VALID);
  expect(t.free).toEqual({
    title: "Free",
    price: "0",
    note: "Every feed starts here.",
    features: [
      { text: "The newest {cap} notes are kept", included: true },
      { text: "No images", included: false },
      { text: "No feed password", included: false },
    ],
  });
  expect(t.plans).toEqual({
    badge: "Per feed",
    note: "For one feed at a time; the key can move.",
    features: [
      { text: "All notes are kept", included: true },
      { text: "Images", included: true },
      { text: "A feed password", included: true },
    ],
    button: "Subscribe",
  });
  expect(t.intro).toBe("A license lifts the free tier's limits for one feed. Reading a feed is always free, and there are no accounts: the license is a key you keep.");
});

test("badge and notes are optional, an unquoted price is a string, an empty body is no intro", () => {
  const t = parseLicensePage("---\nfree:\n  title: Free\n  price: 0\n  features: []\nplans:\n  features:\n    - { text: Images }\n  button: Buy\n---\n");
  expect(t.free).toEqual({ title: "Free", price: "0", features: [] });
  expect(t.plans).toEqual({ features: [{ text: "Images", included: true }], button: "Buy" });
  expect(t.intro).toBe("");
});

test("CRLF and a BOM parse like LF", () => {
  expect(parseLicensePage("﻿" + VALID.replaceAll("\n", "\r\n"))).toEqual(parseLicensePage(VALID));
});

test("no front matter, or an unclosed one, is an error", () => {
  expect(() => parseLicensePage("Just text")).toThrow("license.md has no front matter");
  expect(() => parseLicensePage("---\nfree: {}\n")).toThrow("license.md has no front matter");
});

test("a YAML error names the line, not the text", () => {
  const bad = "---\nfree:\n  title: Free\n  secret-word: [unclosed\n---\nbody";
  expect(() => parseLicensePage(bad)).toThrow(/^license\.md: the front matter is not valid YAML \(line \d+\)$/);
  expect(() => parseLicensePage(bad)).not.toThrow(/secret-word|unclosed/);
});

test("a wrong shape names the field", () => {
  expect(() => parseLicensePage(VALID.replace("  button: Subscribe\n", ""))).toThrow(/^license\.md: plans\.button: /);
  expect(() => parseLicensePage(VALID.replace("plans:", "plan:"))).toThrow(/^license\.md: /);
  expect(() => parseLicensePage(VALID.replace("{ text: Images }", "{ text: Images, include: false }"))).toThrow(/plans\.features\.1/);
});
