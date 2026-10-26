import { expect, test } from "vitest";
import { renderFeed } from "./rss";
import { imgNote, mdNote } from "./note/testing";

const notes = [
  mdNote({ id: "20260929T140512Z-a-b", markdown: "# A & <B>\ncode: a]]>b ]]> end", date: new Date("2026-09-29T14:05:12Z"), tags: ["env:prod", "a&b"] }),
  mdNote({ id: "20260928T090000Z-plain", markdown: "Plain", date: new Date("2026-09-28T09:00:00Z") }),
];
const xml = renderFeed(notes, { title: "my feed", description: "about it", baseUrl: "https://x.test", readId: "AbCdEfGhIjKlMnOpQrSt_-" });

test("is an RSS 2.0 document", () => {
  expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  expect(xml.match(/<rss version="2.0">/g)).toHaveLength(1);
  expect(xml).toContain("<title>my feed</title>");
});

test("escapes titles", () => {
  expect(xml).toContain("<title>A &amp; &lt;B&gt;</title>");
});

test("keeps ]]> intact across CDATA sections", () => {
  const desc = /<description>(.*?)<\/description>/s.exec(xml.split("<item>")[1])![1];
  const text = [...desc.matchAll(/<!\[CDATA\[(.*?)\]\]>/gs)].map((m) => m[1]).join("");
  expect(text).toBe("<h1>A &#x26; &#x3C;B></h1>\n<p>code: a]]>b ]]> end</p>");
});

test("a description is the text as HTML: markdown rendered, raw HTML as text, pictures absolute, the first one the item's image", () => {
  const md = "Look *here*\n\n<b id=x>bold?</b>\n\n![a cat](cat%20one.png) ![](<two pics.webp>) ![far](https://elsewhere.test/c.gif)\n\n| a |\n| - |\n| 1 |";
  const item = renderFeed([mdNote({ id: "m1", markdown: md })], photoOpts).split("<item>")[1];
  const html = [...item.matchAll(/<!\[CDATA\[(.*?)\]\]>/gs)].map((m) => m[1]).join("");
  expect(html).toContain("<p>Look <em>here</em></p>");
  expect(html).toContain("&#x3C;b id=x>bold?&#x3C;/b>"); // never markup a reader would run
  expect(html).not.toContain("<b id");
  expect(html).toContain('<img src="https://x.test/r/AbCdEfGhIjKlMnOpQrSt_-/cat%20one.png" alt="a cat">');
  expect(html).toContain('<img src="https://x.test/r/AbCdEfGhIjKlMnOpQrSt_-/two%20pics.webp" alt="">');
  expect(html).toContain('<img src="https://elsewhere.test/c.gif" alt="far">');
  expect(html).toContain("<table>"); // GFM, as on the page
  expect(item).toContain('<media:content url="https://x.test/r/AbCdEfGhIjKlMnOpQrSt_-/cat%20one.png" type="image/png" medium="image"/>');
  expect(item).toContain('<media:thumbnail url="https://x.test/r/AbCdEfGhIjKlMnOpQrSt_-/cat%20one.png"/>');
  expect(item.match(/<media:content/g)).toHaveLength(1);
  expect(renderFeed([mdNote({ id: "m1", markdown: md })], photoOpts)).toContain('xmlns:media="http://search.yahoo.com/mrss/"');
  expect(xml).not.toContain("xmlns:media"); // no pictures, no namespace
});

test("links are absolute and go through the read id", () => {
  expect(xml).toContain("<link>https://x.test/r/AbCdEfGhIjKlMnOpQrSt_-</link>");
  expect(xml).toContain("<link>https://x.test/r/AbCdEfGhIjKlMnOpQrSt_-/20260929T140512Z-a-b</link>");
  expect(xml).toContain('<guid isPermaLink="true">https://x.test/r/AbCdEfGhIjKlMnOpQrSt_-/20260929T140512Z-a-b</guid>');
  expect(xml).not.toContain("/n/");
});

test("pubDate is RFC 822", () => {
  expect(xml).toContain("<pubDate>Tue, 29 Sep 2026 14:05:12 GMT</pubDate>");
});

test("lists tags as category elements", () => {
  expect(xml).toContain("<category>env:prod</category>\n<category>a&amp;b</category>");
  expect(xml.match(/<category>/g)).toHaveLength(2);
});

test("strips XML-forbidden control characters", () => {
  const out = renderFeed(
    [mdNote({ id: "20260929T140512Z-red", title: "\x1b[31mred", markdown: "\x1b[31mred\x1b[0m\ttab\r\nok", date: new Date() })],
    { title: "t", description: "t", baseUrl: "https://x.test", readId: "AbCdEfGhIjKlMnOpQrSt_-" },
  );
  expect(out).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/);
  expect(out).toContain("[31mred[0m\ttab\r\nok");
});

test("a sender becomes an escaped dc:creator and declares the namespace; none, no namespace", () => {
  const o = { title: "t", description: "t", baseUrl: "https://x.test", readId: "AbCdEfGhIjKlMnOpQrSt_-" };
  const out = renderFeed([mdNote({ id: "20260928T090000Z-plain", markdown: "Plain", sender: "A & <B>" }), notes[0]], o);
  expect(out).toContain('<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">');
  expect(out.match(/<dc:creator>/g)).toHaveLength(1);
  expect(out).toContain("<dc:creator>A &amp; &lt;B&gt;</dc:creator>");
  expect(xml).not.toContain("dc");
});

const photoOpts = { title: "t", description: "t", baseUrl: "https://x.test", readId: "AbCdEfGhIjKlMnOpQrSt_-" };

test("an image note is an item with an enclosure and no description, titled by its alt text, its file's name, else what and when", () => {
  const out = renderFeed([imgNote({ id: "20260930T100000Z-pic", ext: "jpg", size: 2048, date: new Date("2026-09-30T10:00:00Z") })], photoOpts);
  expect(out).toMatch(/<title>Picture, 30 Sept? 2026, \d\d:00<\/title>/); // never its id
  expect(out).not.toContain("<title>20260930T100000Z-pic</title>");
  expect(renderFeed([imgNote({ id: "p", alt: "A cat", name: "IMG_1.jpg" })], photoOpts)).toContain("<title>A cat</title>");
  expect(renderFeed([imgNote({ id: "p", name: "IMG_1.jpg" })], photoOpts)).toContain("<title>IMG_1.jpg</title>");
  expect(out).toContain('<enclosure url="https://x.test/r/AbCdEfGhIjKlMnOpQrSt_-/20260930T100000Z-pic.jpg" length="2048" type="image/jpeg"/>');
  expect(out).toContain("<link>https://x.test/r/AbCdEfGhIjKlMnOpQrSt_-/20260930T100000Z-pic</link>"); // the note page, not the file
  expect(out.split("<item>")[1]).not.toContain("<description>"); // the channel has one
  expect(out).toContain("<pubDate>Wed, 30 Sep 2026 10:00:00 GMT</pubDate>");
});

test("a sidecar title is the item's title, for an image and for markdown; tags and sender still show", () => {
  const out = renderFeed(
    [imgNote({ id: "i1", title: "A <cat>", sender: "Ann", tags: ["pets"] }), mdNote({ id: "m1", markdown: "# Derived", title: "Set" })],
    photoOpts,
  );
  expect(out).toContain("<title>A &lt;cat&gt;</title>");
  expect(out).toContain("<title>Set</title>");
  expect(out).toContain("<dc:creator>Ann</dc:creator>");
  expect(out).toContain("<category>pets</category>");
});

test("a markdown item has no enclosure", () => {
  expect(renderFeed([mdNote({ id: "m1", markdown: "x" })], photoOpts)).not.toContain("<enclosure");
});
