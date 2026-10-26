// A markdown note's text as HTML, for RSS readers, which show a description as HTML (issue: the literal `![](…)` in a reader). The same
// parser as the page (react-markdown: remark with GFM), so a reader shows what the page shows. Raw HTML in a note stays text, as on the
// page: it is never run in a reader either. Pictures of the feed (relative links) become absolute, readers having no base to resolve them.
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { isRelativeLink } from "../shared/links";
import { imageSizes } from "../shared/markdown";

type Node = { type: string; value?: string; tagName?: string; properties?: Record<string, unknown>; children?: Node[] };

const walk = (node: Node, visit: (n: Node) => void) => {
  visit(node);
  node.children?.forEach((c) => walk(c, visit));
};

// Raw HTML (a markdown `html` node) becomes plain text, escaped on output.
const htmlAsText = () => (tree: Node) =>
  walk(tree, (n) => {
    if (n.type === "html") n.type = "text";
  });

const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

/** The picture's media type by its file's extension, or undefined when it is none of the picture types notes hold. */
export const imageType = (url: string): string | undefined => IMAGE_TYPES[/\.([a-z0-9]+)(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase() ?? ""];

/** `base`: the feed's read link with a trailing slash. `image` is the text's first picture, absolute. */
export function markdownToHtml(markdown: string, base: string): { html: string; image?: string } {
  let image: string | undefined;
  const pictures = () => (tree: Node) =>
    walk(tree, (n) => {
      if (n.tagName !== "img" || typeof n.properties?.src !== "string") return;
      const src = isRelativeLink(n.properties.src) ? base + n.properties.src.replaceAll(" ", "%20") : n.properties.src;
      n.properties.src = src;
      image ??= src;
    });
  const html = String(unified().use(remarkParse).use(remarkGfm).use(htmlAsText).use(remarkRehype).use(imageSizes).use(pictures).use(rehypeStringify).processSync(markdown));
  return { html, image };
}
