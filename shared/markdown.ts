// What the page (components/NoteView.tsx) and RSS (backend/rsshtml.ts) both do to a note's markdown beyond GFM, so they agree (#243):
// a picture's size from its link, and ids for the headings of a long note.
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

type Node = { type: string; value?: string; tagName?: string; depth?: number; properties?: Record<string, unknown>; children?: Node[] };

const walk = (node: Node, visit: (n: Node) => void) => {
  visit(node);
  node.children?.forEach((c) => walk(c, visit));
};

// The text of a heading as a reader sees it: its text and inline code, the same from the markdown tree (mdast) and the HTML one (hast).
const textOf = (node: Node): string => (node.type === "text" || node.type === "inlineCode" ? (node.value ?? "") : (node.children ?? []).map(textOf).join(""));

/** Slugs as GitHub makes them: lower case, letters, digits, `-` and `_` kept, spaces as `-`; a repeat gets `-1`, `-2`, … */
export function slugger(): (text: string) => string {
  const seen = new Map<string, number>();
  return (text) => {
    const base = text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-") || "section";
    const n = seen.get(base);
    seen.set(base, (n ?? -1) + 1);
    return n === undefined ? base : `${base}-${n + 1}`;
  };
}

/** Rehype: every heading gets an `id` from its text, in the order of the text, as `headingsOf` lists them. */
export const headingIds = () => (tree: Node) => {
  const slug = slugger();
  walk(tree, (n) => {
    if (n.type === "element" && /^h[1-6]$/.test(n.tagName ?? "")) n.properties = { ...n.properties, id: slug(textOf(n)) };
  });
};

export type Heading = { depth: number; text: string; id: string };

/** The headings of a markdown text with the ids `headingIds` gives them: what a long note's table of contents lists. */
export function headingsOf(markdown: string): Heading[] {
  const slug = slugger();
  const found: Heading[] = [];
  walk(unified().use(remarkParse).use(remarkGfm).parse(markdown) as Node, (n) => {
    if (n.type !== "heading") return;
    const text = textOf(n);
    found.push({ depth: n.depth ?? 1, text, id: slug(text) });
  });
  return found;
}

// `#width=480`, `#height=270` or both (`#width=480&height=270`) at the end of a picture's link: the size it shows at, in CSS pixels
// (1 to 4096), never larger than the column. Any other fragment is left as it is. Markdown has no syntax for a size; a fragment keeps
// the link valid everywhere else, where the picture shows at its own size.
const SIZE = /#((?:width|height)=\d{1,4})(?:&((?:width|height)=\d{1,4}))?$/;

/** Rehype: a picture's size from its link's fragment, as `width` and `height`; the fragment is taken off the link. */
export const imageSizes = () => (tree: Node) =>
  walk(tree, (n) => {
    const src = n.tagName === "img" ? n.properties?.src : undefined;
    const m = typeof src === "string" ? SIZE.exec(src) : null;
    if (!m) return;
    const size: Record<string, number> = {};
    for (const pair of [m[1], m[2]]) {
      const [key, value] = pair?.split("=") ?? [];
      if (key && Number(value) >= 1 && Number(value) <= 4096) size[key] = Number(value);
    }
    n.properties = { ...n.properties, src: (src as string).slice(0, m.index), ...size };
  });
