import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { NoteView } from "./NoteView";

const srcs = (markdown: string, imageBase?: string) => [...renderToStaticMarkup(<NoteView markdown={markdown} imageBase={imageBase} />).matchAll(/<img src="([^"]*)"/g)].map((m) => m[1]);

test("a relative image link is shown from the feed's current read link, others stay as written", () => {
  const md = "![](a.png) ![](https://x.test/b.png) ![](/r/old/c.png) ![](//x.test/d.png)";
  expect(srcs(md, "/r/new/")).toEqual(["/r/new/a.png", "https://x.test/b.png", "/r/old/c.png", "//x.test/d.png"]);
  expect(srcs(md)[0]).toBe("a.png"); // no read link yet: nothing to resolve against
});

test("a resolver wins for the links it knows, the rest resolve as before (#146)", () => {
  const html = renderToStaticMarkup(<NoteView markdown="![](cat.png) ![](b.png)" imageBase="/r/rid/" resolve={(s) => (s === "cat.png" ? "blob:cat" : undefined)} />);
  expect([...html.matchAll(/<img src="([^"]*)"/g)].map((m) => m[1])).toEqual(["blob:cat", "/r/rid/b.png"]);
});

test("a picture with a note of its own links to that note's page, unless the text already put it in a link", () => {
  const link = (s: string) => (s === "beach.png" ? "/f/p1" : undefined);
  const html = renderToStaticMarkup(<NoteView markdown={"![](beach.png)\n\n![](other.png)\n\n[![](beach.png)](https://x.test)"} imageBase="/r/rid/" link={link} />);
  expect(html.match(/<a [^>]*href="\/f\/p1"[^>]*><img src="\/r\/rid\/beach.png"/g)).toHaveLength(1);
  expect(html).toContain('<a href="https://x.test"><img src="/r/rid/beach.png"'); // no link in a link
  expect(html).not.toMatch(/href="[^"]*"[^>]*><img src="\/r\/rid\/other.png"/);
  expect(html).not.toContain("<a href=\"/f/p1\"><a"); // never nested
});
