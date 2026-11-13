import { expect, test } from "vitest";
import { COPIES, DEFAULT_LOCALE, negotiate } from "./index";

// The shape of a copy module: every key, and for each whether it is a string or a function of how many arguments.
function shape(v: unknown): unknown {
  if (typeof v === "string") return "string";
  if (typeof v === "function") return `function/${v.length}`;
  return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, shape(x)]));
}

test.each(Object.entries(COPIES))("the %s copy has exactly English's keys, of the same kinds", (_, copy) => {
  expect(shape(copy)).toEqual(shape(COPIES.en));
});

test("no English string is empty", () => {
  const walk = (v: unknown): string[] => (typeof v === "string" ? [v] : typeof v === "object" ? Object.values(v as object).flatMap(walk) : []);
  expect(walk(COPIES.en).filter((s) => !s.trim())).toEqual([]);
});

test("negotiate: the picked language, else the best one the browser asks for, else English", () => {
  expect(negotiate(undefined, null)).toBe(DEFAULT_LOCALE);
  expect(negotiate(undefined, "fr-CH, fr;q=0.9, en;q=0.8")).toBe("en");
  expect(negotiate(undefined, "en-GB")).toBe("en");
  expect(negotiate(undefined, "xx, en;q=0")).toBe("en"); // nothing it speaks: the default
  expect(negotiate("en", "fr")).toBe("en");
  expect(negotiate("xx", "en")).toBe("en"); // a picked language it doesn't speak is ignored
});
