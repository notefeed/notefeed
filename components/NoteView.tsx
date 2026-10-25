import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isRelativeLink } from "@/shared/links";

type Hast = { type: string; tagName?: string; properties?: Record<string, unknown>; children?: Hast[] };

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
export function NoteView({ markdown, imageBase, resolve, link }: { markdown: string; imageBase?: string; resolve?: (src: string) => string | undefined; link?: (src: string) => string | undefined }) {
  return (
    <div className="md break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={link ? [markPicturesInLinks] : []}
        components={{
          // User-uploaded images from our own route: next/image's optimizer has nothing to add (max-width is in globals.css).
          img: ({ src, alt, title, node }) => {
            const own = typeof src === "string" ? resolve?.(src) : undefined;
            const url = own ?? (typeof src === "string" && imageBase && isRelativeLink(src) ? imageBase + src : src);
            // eslint-disable-next-line @next/next/no-img-element
            const img = <img src={typeof url === "string" ? url : undefined} alt={alt ?? ""} title={title} loading="lazy" />;
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
