// RSS 2.0, written by hand. Descriptions carry the note's text as HTML in CDATA (backend/rsshtml.ts).
import { ImageNote } from "./note/image";
import type { Note } from "./notes";
import { readPath } from "./urls";

// XML 1.0 forbids most C0 controls (e.g. ANSI color codes from scripts); one would break the whole feed.
// Stripped on output only — the .md file keeps the original bytes.
const xmlSafe = (s: string) => s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, "");

const escapeXml = (s: string) =>
  xmlSafe(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);

// "]]>" would end the section early; split it across two CDATA sections.
const cdata = (s: string) => `<![CDATA[${xmlSafe(s).replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;

// An item's title: the note's, else a picture's alternative text or the name it was posted with, else what it is and when, never its id.
function itemTitle(n: Note): string {
  const when = n.date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  return n.title || n.alt || (n instanceof ImageNote ? n.name : undefined) || `${n instanceof ImageNote ? "Picture" : "Note"}, ${when}`;
}

// Links go through the read id only, so the feed never reveals the (writable) feed name.
export function renderFeed(notes: Note[], opts: { title: string; description: string; baseUrl: string; readId: string; imageUrl?: string }): string {
  const base = opts.baseUrl + readPath(opts.readId);
  const items = notes.map((n) => {
    const url = `${base}/${n.id}`;
    const { description, enclosure, image } = n.rssContent(base);
    return `<item>
<title>${escapeXml(itemTitle(n))}</title>
<link>${url}</link>
<guid isPermaLink="true">${url}</guid>
<pubDate>${n.date.toUTCString()}</pubDate>
${description === undefined ? "" : `<description>${cdata(description)}</description>\n`}${enclosure ? `<enclosure url="${escapeXml(enclosure.url)}" length="${enclosure.length}" type="${enclosure.type}"/>\n` : ""}${image ? `<media:content url="${escapeXml(image.url)}" type="${image.type}" medium="image"/>\n<media:thumbnail url="${escapeXml(image.url)}"/>\n` : ""}${n.sender ? `<dc:creator>${escapeXml(n.sender)}</dc:creator>\n` : ""}${n.tags.map((t) => `<category>${escapeXml(t)}</category>\n`).join("")}</item>`;
  });
  const media = items.some((i) => i.includes("<media:"));
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"${notes.some((n) => n.sender) ? ' xmlns:dc="http://purl.org/dc/elements/1.1/"' : ""}${media ? ' xmlns:media="http://search.yahoo.com/mrss/"' : ""}>
<channel>
<title>${escapeXml(opts.title)}</title>
<link>${base}</link>
<description>${escapeXml(opts.description)}</description>
${opts.imageUrl ? `<image><url>${escapeXml(opts.imageUrl)}</url><title>${escapeXml(opts.title)}</title><link>${base}</link></image>\n` : ""}${items.join("\n")}
</channel>
</rss>
`;
}
