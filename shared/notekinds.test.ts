import { expect, test } from "vitest";
import { attachmentLinks, kindOf, withoutAttachments } from "./notekinds";

const md = (id: string, content: string) => ({ id, type: "text/markdown", file: `${id}.md`, content });
const pic = (id: string, file: string) => ({ id, type: "image/png", file });

test("a picture a markdown note in the list shows is left out; one nobody shows stays", () => {
  const notes = [md("n1", "# Trip\n\n![](beach.png)"), pic("p1", "beach.png"), pic("p2", "alone.png")];
  expect(withoutAttachments(notes).map((n) => n.id)).toEqual(["n1", "p2"]);
});

test("every form the server writes counts: a title, <angle brackets>, percent-encoding, a reference definition", () => {
  const text = ['![a](one.png "t")', "![b](<two words.png>)", "![c](three%20x.png)", "![d][four]", "", "[four]: four.png"].join("\n");
  const notes = [md("n1", text), pic("p1", "one.png"), pic("p2", "two words.png"), pic("p3", "three x.png"), pic("p4", "four.png")];
  expect(withoutAttachments(notes).map((n) => n.id)).toEqual(["n1"]);
});

test("only relative names are this feed's pictures: a URL or a path to elsewhere hides nothing", () => {
  const notes = [md("n1", "![](https://x.example/beach.png) ![](/r/abc/beach.png)"), pic("p1", "beach.png")];
  expect(withoutAttachments(notes).map((n) => n.id)).toEqual(["n1", "p1"]);
});

test("a picture is only left out when the note showing it is in the same list (a tag filter may show the picture alone)", () => {
  expect(withoutAttachments([pic("p1", "beach.png")]).map((n) => n.id)).toEqual(["p1"]);
});

test("the links from a picture's file to its note page, for the pictures in the list", () => {
  const links = attachmentLinks([md("n1", "![](beach.png)"), pic("p1", "beach.png"), pic("p2", "two words.png")], "/herziis");
  expect(links("beach.png")).toBe("/herziis/p1");
  expect(links("two%20words.png")).toBe("/herziis/p2");
  expect(links("nope.png")).toBeUndefined();
  expect(links("https://x.example/beach.png")).toBeUndefined();
});

test("a note's kind comes from its media type", () => {
  expect(kindOf("text/markdown; charset=utf-8").name).toBe("markdown");
  expect(kindOf("image/webp").name).toBe("image");
});
