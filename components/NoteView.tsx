import Link from "next/link";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { PluggableList } from "unified";
import remarkGfm from "remark-gfm";
import { isRelativeLink } from "@/shared/links";
import { headingIds, imageSizes } from "@/shared/markdown";
import { MermaidBlock } from "@/components/MermaidBlock";

type Hast = { type: string; value?: string; tagName?: string; properties?: Record<string, unknown>; children?: Hast[] };

// The text of a `<pre><code class="language-mermaid">` block, or undefined for any other `<pre>`.
function mermaidSource(pre: Hast | undefined): string | undefined {
  const code = pre?.children?.find((c) => c.tagName === "code");
  const classes = code?.properties?.className;
  if (!Array.isArray(classes) || !classes.includes("language-mermaid")) return undefined;
  const text = (n: Hast): string => n.value ?? (n.children ?? []).map(text).join("");
  return text(code!);
}

// Marks the pictures that sit inside a link of the text, so that `link` does not wrap them in a second one (a link in a link).
const markPicturesInLinks = () => (tree: Hast) => {
  const walk = (node: Hast, inLink: boolean) => {
    const here = inLink || node.tagName === "a";
    if (node.tagName === "img" && here) node.properties = { ...node.properties, dataInLink: true };
    node.children?.forEach((c) => walk(c, here));
  };
  walk(tree, false);
};

// Raw HTML in notes stays escaped: no rehype-raw. `resolve` gives a picture's URL for a link the text holds (the compose box's preview
// shows the pictures waiting in it from their files, by the name the text calls them, issue #146); undefined falls through to `imageBase`.
// `link` gives the page of the picture's own note (shared/notekinds.ts), which the picture then links to unless the text put it in a link.
// `anchors` (a note's own page, #243): each heading gets an id and a link to itself. A picture's size comes from its link (shared/markdown.ts).
// `plugins`: more rehype plugins, from a server component, so what they need stays out of the browser's bundle (code highlighting).
// `diagrams` (a note's own page and the timeline, #301): a ```mermaid block is drawn in the browser, its source the fallback (MermaidBlock).
export function NoteView({ markdown, imageBase, resolve, link, anchors = false, plugins = [], diagrams = false }: { markdown: string; imageBase?: string; resolve?: (src: string) => string | undefined; link?: (src: string) => string | undefined; anchors?: boolean; plugins?: PluggableList; diagrams?: boolean }) {
  return (
    <div className="md break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[imageSizes, ...(link ? [markPicturesInLinks] : []), ...(anchors ? [headingIds] : []), ...plugins]}
        components={{
          ...(anchors && Object.fromEntries(HEADINGS.map((H) => [H, (props: HeadingProps) => <AnchoredHeading as={H} {...props} />]))),
          ...(diagrams && {
            pre: ({ node, children }) => {
              const source = mermaidSource(node as Hast | undefined);
              return source === undefined ? <pre>{children}</pre> : <MermaidBlock source={source}><pre>{children}</pre></MermaidBlock>;
            },
          }),
          // User-uploaded images from our own route: next/image's optimizer has nothing to add (max-width is in globals.css).
          img: ({ src, alt, title, width, height, node }) => {
            const own = typeof src === "string" ? resolve?.(src) : undefined;
            const url = own ?? (typeof src === "string" && imageBase && isRelativeLink(src) ? imageBase + src : src);
            // eslint-disable-next-line @next/next/no-img-element
            const img = <img src={typeof url === "string" ? url : undefined} alt={alt ?? ""} title={title} width={width} height={height} loading="lazy" />;
            const page = typeof src === "string" && !node?.properties?.dataInLink ? link?.(src) : undefined;
            return page ? (
              <Link href={page} className="block w-fit">
                {img}
              </Link>
            ) : (
              img
            );
          },
        }}
      >{markdown}</ReactMarkdown>
    </div>
  );
}

const HEADINGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;
type HeadingProps = { id?: string; children?: ReactNode };

// A heading with a link to itself after its text, shown on hover or focus: the address to share a part of a long note.
function AnchoredHeading({ as: H, id, children }: HeadingProps & { as: (typeof HEADINGS)[number] }) {
  return (
    <H id={id} className="scroll-mt-20">
      {children}
      {id && (
        <a href={`#${id}`} aria-label="Link to this section" className="anchor">
          #
        </a>
      )}
    </H>
  );
}
