import Link from "next/link";
import type { ReactNode } from "react";
import { NoteView } from "@/components/NoteView";
import type { Note } from "@/backend";
import { kindOf, type KindName } from "@/shared/notekinds";
import { bodyAfterTitle, extractTitle } from "@/shared/notes";
import { cleanLine } from "@/shared/links";

// How each kind of note (shared/notekinds.ts) shows, in a list's card or on its own page (ADR 0038). A body draws content only;
// where a click goes is decided by CardContent and PageContent below: `open` is where the whole content links (in a
// card, the note's own page), `attachmentLink` where an attachment inside it links.
export type Place = "card" | "page";
type ContentProps = { note: Note; place: Place; imageBase?: string; open?: string; attachmentLink?: (src: string) => string | undefined };
type Body = {
  /** The heading above the content, or none. */
  heading(note: Note, place: Place): string | undefined;
  Content(props: ContentProps): ReactNode;
};

// An image note's picture, from the feed's current read link (`imageBase`), so it follows a changed read id. The text alternative is
// the note's own, else its title, else none: a picture without a description is decoration to a screen reader, not a file name.
function Picture({ note, imageBase, className }: { note: Note; imageBase?: string; className: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={(imageBase ?? "") + note.file} alt={note.alt ?? note.title} loading="lazy" className={className} />;
}

// A markdown note's own title (set when posted or edited, not taken from the text) is its heading, and the text shows whole.
const ownTitle = (note: Note) => note.meta.title !== undefined && note.title !== "" && note.title !== cleanLine(extractTitle(note.content ?? ""));

// A title taken from the text: the card shows it as the heading and the text after the title's line; the page does the same,
// except when the title is a picture's alt text (the picture stays) or a `# ` heading further down (the text shows it in its place).
function titledPage(markdown: string): boolean {
  const first = markdown.split(/\r?\n/).find((l) => l.trim() !== "")?.trim() ?? "";
  return !/^!\[[^\]]*\]\([^)]*\)$/.test(first) && bodyAfterTitle(markdown) !== markdown.trim();
}

const markdown: Body = {
  heading: (note, place) => (place === "card" ? note.title || note.id : ownTitle(note) || titledPage(note.content ?? "") ? note.title || undefined : undefined),
  Content({ note, place, imageBase, attachmentLink }) {
    const text = note.content ?? "";
    const own = ownTitle(note);
    if (place === "page") return <NoteView markdown={!own && titledPage(text) ? bodyAfterTitle(text) : text} imageBase={imageBase} link={attachmentLink} />;
    const rest = own ? text.trim() : bodyAfterTitle(text);
    return (
      rest && (
        <div className="mt-1 text-[15px]">
          <NoteView markdown={rest} imageBase={imageBase} link={attachmentLink} />
        </div>
      )
    );
  },
};

const image: Body = {
  heading: (note) => note.title || undefined,
  Content({ note, place, imageBase, open }) {
    if (place === "page") return <Picture note={note} imageBase={imageBase} className="max-w-full rounded-xl" />;
    const picture = <Picture note={note} imageBase={imageBase} className="max-h-96 w-full rounded-xl object-cover" />;
    return open ? (
      <Link href={open} className={`block ${note.title ? "mt-3" : ""}`}>
        {picture}
      </Link>
    ) : (
      picture
    );
  },
};

const BODIES: Record<KindName, Body> = { markdown, image };

// Where a click on a note goes is decided here, the same for every kind (ADR 0038): in a list, everything on a note's card opens
// that note, its attachments too; on a note's own page, an attachment opens the attachment's own page.
export function CardContent({ note, open, imageBase, attachments }: { note: Note; open: string; imageBase?: string; attachments: (src: string) => string | undefined }) {
  const body = BODIES[kindOf(note.type).name];
  const heading = body.heading(note, "card");
  return (
    <>
      {heading && (
        <Link href={open} className="block text-[17px] font-bold tracking-tight hover:text-carbon">
          {heading}
        </Link>
      )}
      <body.Content note={note} place="card" imageBase={imageBase} open={open} attachmentLink={(src) => (attachments(src) ? open : undefined)} />
    </>
  );
}

export function PageContent({ note, imageBase, attachments }: { note: Note; imageBase?: string; attachments?: (src: string) => string | undefined }) {
  const body = BODIES[kindOf(note.type).name];
  const heading = body.heading(note, "page");
  return (
    <>
      {heading && <h1 className="mb-2 text-xl font-bold tracking-tight">{heading}</h1>}
      <body.Content note={note} place="page" imageBase={imageBase} attachmentLink={attachments} />
    </>
  );
}

// Notes as cards, grouped by day under sticky labels; each title links to `${base}/${id}`. `imageBase` is where a note's relative
