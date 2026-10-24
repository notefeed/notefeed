import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { ImageNote, MarkdownNote, UnreadableNote } from "@/backend";
import { NoteArticle, NoteList } from "./NoteList";

// A note as the backend hands it out, without touching the disk.
const at0 = new Date(0);
const mdNote = ({ id, markdown, createdAt = at0 }: { id: string; markdown: string; createdAt?: Date }) => new MarkdownNote({ id, ext: "md", meta: {}, createdAt, size: markdown.length }, markdown);
const imgNote = ({ id, ext = "png", createdAt = at0, title, alt }: { id: string; ext?: string; createdAt?: Date; title?: string; alt?: string }) =>
  new ImageNote({ id, ext, meta: { ...(title && { title }), ...(alt && { alt }) }, createdAt, size: 12 });

const list = (notes: Parameters<typeof NoteList>[0]["notes"], imageBase = "/r/rid/") => renderToStaticMarkup(<NoteList notes={notes} base="/feed" imageBase={imageBase} />);

test("an image note shows its picture from the read link, linked to its page", () => {
  const html = list([imgNote({ id: "20260930T100000Z-pic", ext: "jpg", createdAt: new Date("2026-09-30T10:00:00Z") })]);
  expect(html).toMatch(/<a [^>]*href="\/feed\/20260930T100000Z-pic"/);
  expect(html).toMatch(/<img src="\/r\/rid\/20260930T100000Z-pic\.jpg"/);
  expect(html).not.toContain("![]("); // no raw markdown
});

test("the picture's alt text is the note's alt, else its title, else empty", () => {
  const alts = (html: string) => [...html.matchAll(/<img[^>]*alt="([^"]*)"/g)].map((m) => m[1]);
  const at = new Date("2026-09-30T10:00:00Z");
  expect(alts(list([imgNote({ id: "a", createdAt: at })]))).toEqual([""]);
  expect(alts(list([imgNote({ id: "b", createdAt: at, title: "Titled" })]))).toEqual(["Titled"]);
});

test("an image note's title shows as its link text above the picture; none shows no id", () => {
  const at = new Date("2026-09-30T10:00:00Z");
  expect(list([imgNote({ id: "x1", createdAt: at, title: "A cat" })])).toContain(">A cat</a>");
  expect(list([imgNote({ id: "x2", createdAt: at })])).not.toContain(">x2</a>");
});

test("a markdown note is listed as before: title link, then the rest of the text", () => {
  const html = list([mdNote({ id: "m1", markdown: "# Hello\nsome *text*", createdAt: new Date("2026-09-30T10:00:00Z") })]);
  expect(html).toContain(">Hello</a>");
  expect(html).toContain("<em>text</em>");
});

test("a Report link per note fills the template with the read id, the note id and the file; none without a template (#154)", () => {
  const at = new Date("2026-09-30T10:00:00Z");
  const report = { template: "https://r.example/?r={read_id}&n={note_id}&f={file}", readId: "rid" };
  const html = renderToStaticMarkup(<NoteList notes={[mdNote({ id: "m1", markdown: "# Hi", createdAt: at }), imgNote({ id: "p1", ext: "jpg", createdAt: at })]} base="/feed" imageBase="/r/rid/" report={report} />);
  expect(html).toContain('href="https://r.example/?r=rid&amp;n=m1&amp;f=m1.md" rel="nofollow noopener"');
  expect(html).toContain('href="https://r.example/?r=rid&amp;n=p1&amp;f=p1.jpg"');
  expect(html.match(/>Report<\/a>/g)).toHaveLength(2);
  expect(list([mdNote({ id: "m1", markdown: "# Hi", createdAt: at })])).not.toContain("Report");
  const article = renderToStaticMarkup(<NoteArticle note={mdNote({ id: "m2", markdown: "# Hi", createdAt: at })} back="/feed" report={report} />);
  expect(article).toContain('href="https://r.example/?r=rid&amp;n=m2&amp;f=m2.md"');
});

test("the note page shows the picture large, with its title", () => {
  const html = renderToStaticMarkup(<NoteArticle note={imgNote({ id: "p1", ext: "webp", title: "Cat", createdAt: new Date("2026-09-30T10:00:00Z") })} back="/feed" imageBase="/r/rid/" />);
  expect(html).toMatch(/<img src="\/r\/rid\/p1\.webp"/);
  expect(html).toContain(">Cat<");
});

test("a damaged note is a placeholder in its place: no title, no content, a link to its page, the reason in words", () => {
  const html = list([mdNote({ id: "a", markdown: "# A", createdAt: new Date(2) }), new UnreadableNote("b", "md", new Date(1))]);
  expect(html.indexOf(">A<")).toBeLessThan(html.indexOf("can&#x27;t be shown"));
  expect(html).toContain("This note can&#x27;t be shown: its stored copy can&#x27;t be decrypted.");
  expect(html).toContain('href="/feed/b"');
  expect(html).not.toContain(">b<"); // the id is no title
});

test("a picture a markdown note in the list shows is not listed again; in the list the note's picture opens the note", () => {
  const at = new Date("2026-10-24T10:00:00Z");
  const html = list([mdNote({ id: "n1", markdown: "# Herzii\n\n![](p1.png)", createdAt: at }), imgNote({ id: "p1", createdAt: at }), imgNote({ id: "p2", createdAt: at })]);
  expect(html.match(/<li /g)).toHaveLength(2); // the markdown note and the picture nobody shows
  expect(html).toMatch(/<a [^>]*href="\/feed\/n1"[^>]*><img src="\/r\/rid\/p1\.png"/); // the note first; its page links the picture's

  expect(html.match(/src="\/r\/rid\/p1\.png"/g)).toHaveLength(1);
  expect(html).toMatch(/src="\/r\/rid\/p2\.png"/);
});
