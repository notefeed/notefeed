import { expect, test } from "vitest";
import { sortTags } from "./tags";

const notes = (...tags: string[][]) => tags.map((t) => ({ tags: t }));

test("tags of equal count run by name, numbers within a name as numbers (#241)", () => {
  expect(sortTags(notes(["v0.10.0"], ["v0.2.0"], ["release"], ["v0.9.1"]))).toEqual(["release", "v0.2.0", "v0.9.1", "v0.10.0"]);
});

test("the most used tags come first", () => {
  expect(sortTags(notes(["b", "v10"], ["b", "v9"], ["a"]))).toEqual(["b", "a", "v9", "v10"]);
});
