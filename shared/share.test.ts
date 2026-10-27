import { expect, test } from "vitest";
import { shareQuery } from "./share";

test("only what was shared is carried, in a fixed order", () => {
  expect(shareQuery({ share_text: "hi", feed: "x" })).toBe("?share_text=hi");
  expect(shareQuery({ shared: "1", share_url: ["a", "b"] })).toBe("?share_url=a&shared=1");
  expect(shareQuery(new URLSearchParams("share_title=T&error=bad"))).toBe("?share_title=T");
});

test("nothing shared is no query at all", () => {
  expect(shareQuery({})).toBe("");
  expect(shareQuery({ share_title: "" })).toBe("");
  expect(shareQuery(new URLSearchParams(""))).toBe("");
});
