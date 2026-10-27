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

test("a picture's size comes from its link's fragment, which is taken off; other fragments stay (#243)", () => {
  const html = renderToStaticMarkup(<NoteView markdown={"![](a.png#width=480) ![](b.png#width=320&height=200) ![](c.png#height=99999) ![](d.png#top)"} imageBase="/r/rid/" link={(s) => (s === "a.png" ? "/f/a" : undefined)} />);
  expect(html).toContain('<img src="/r/rid/a.png" alt="" width="480" loading="lazy"/>');
  expect(html).toContain('href="/f/a"'); // the attachment is still found by its name
  expect(html).toContain('<img src="/r/rid/b.png" alt="" width="320" height="200"');
  expect(html).toContain('<img src="/r/rid/c.png#height=99999"'); // out of range: not a size
  expect(html).toContain('<img src="/r/rid/d.png#top"');
});

test("on a note's page each heading has an id and a link to itself; in a card it has neither (#243)", () => {
  const md = "# Notes on `yaml`\n\n## Setup\n\n## Setup\n\n### Größe & Co.";
  const page = renderToStaticMarkup(<NoteView markdown={md} anchors />);
  expect([...page.matchAll(/<h\d id="([^"]+)"/g)].map((m) => m[1])).toEqual(["notes-on-yaml", "setup", "setup-1", "größe--co"]);
  expect(page).toContain('<a href="#setup-1" aria-label="Link to this section" class="anchor">#</a>');
  expect(renderToStaticMarkup(<NoteView markdown={md} />)).not.toMatch(/ id="|class="anchor"/);
});
