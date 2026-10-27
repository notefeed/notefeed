import { expect, test } from "vitest";
import { headingsOf, slugger } from "./markdown";

test("slugs as GitHub makes them, repeats numbered", () => {
  const slug = slugger();
  expect(["Setup", "Setup", "What's next?", "  ", "Ünïcode 2"].map(slug)).toEqual(["setup", "setup-1", "whats-next", "section", "ünïcode-2"]);
});

test("headingsOf lists every heading with the id the page gives it (#243)", () => {
  expect(headingsOf("# T\n\ntext\n\n## A `b` ~~c~~\n\n```\n# not a heading\n```\n\n### A b c")).toEqual([
    { depth: 1, text: "T", id: "t" },
    { depth: 2, text: "A b c", id: "a-b-c" },
    { depth: 3, text: "A b c", id: "a-b-c-1" },
  ]);
});
