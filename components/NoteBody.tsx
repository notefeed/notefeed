import type { ReactNode } from "react";
import rehypeHighlight from "rehype-highlight";
import type { PluggableList } from "unified";
import { NoteView } from "@/components/NoteView";
import type { Note } from "@/backend";
import { kindOf, REMOVED_NOTE, type KindName } from "@/shared/notekinds";
import { extractTitle } from "@/shared/notes";
import { cleanLine } from "@/shared/links";
import { headingsOf, type Heading } from "@/shared/markdown";

// How each kind of note (shared/notekinds.ts) shows, in a list's card or on its own page (ADR 0038). A body draws content only;
// where a click goes is decided by CardContent and PageContent below: `attachmentLink` is where an attachment inside it links.
export type Place = "card" | "page";
type ContentProps = { note: Note; place: Place; imageBase?: string; attachmentLink?: (src: string) => string | undefined };
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

// A markdown note shows its text as written (ADR 0040); only a title of its own (set when posted or edited) is a heading above it.
// A stored title that is the text's first line already shows in the text.
const ownTitle = (note: Note) => (note.meta.title !== undefined && note.title !== "" && note.title !== cleanLine(extractTitle(note.content ?? "")) ? note.title : undefined);

// Rendered here, on the server: a code block with a language is highlighted (#243), with the colours in globals.css.
const SERVER_PLUGINS: PluggableList = [rehypeHighlight];

const markdown: Body = {
  heading: (note) => ownTitle(note),
  Content({ note, place, imageBase, attachmentLink }) {
    const text = note.content ?? "";
    if (place === "page") {
      return (
        <>
          <Contents headings={headingsOf(text)} />
          <NoteView markdown={text} imageBase={imageBase} link={attachmentLink} anchors diagrams plugins={SERVER_PLUGINS} />
        </>
      );
    }
    return (
      text.trim() && (
        <div className={`note-card text-[15px] ${ownTitle(note) ? "mt-1" : ""}`}>
          <NoteView markdown={text} imageBase={imageBase} link={attachmentLink} diagrams plugins={SERVER_PLUGINS} />
        </div>
      )
    );
  },
};

// A long note's table of contents on its own page (#243): its second- and third-level headings, once there are three or more.
function Contents({ headings }: { headings: Heading[] }) {
  const listed = headings.filter((h) => h.depth === 2 || h.depth === 3);
  if (listed.length < 3) return null;
  return (
    <nav aria-label="Contents" className="mb-5 rounded-xl border border-rule px-4 py-3 text-[14px]">
      <p className="mb-1 font-bold">Contents</p>
      <ol className="space-y-0.5">
        {listed.map((h) => (
          <li key={h.id} className={h.depth === 3 ? "pl-4" : ""}>
            <a href={`#${h.id}`} className="text-carbon hover:underline">
              {h.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

const image: Body = {
  heading: (note) => note.title || undefined,
  Content({ note, place, imageBase }) {
    if (place === "page") return <Picture note={note} imageBase={imageBase} className="max-h-[80vh] max-w-full rounded-xl object-contain" />;
    return <Picture note={note} imageBase={imageBase} className={`max-h-96 w-full max-w-[40rem] rounded-xl object-cover ${note.title ? "mt-3" : ""}`} />;
  },
};

// The operator's mark (#159): what happened, nothing of what was there. The terms link is the list's and the page's (NoteList, RemovedNote).
const removed: Body = {
  heading: () => undefined,
  Content: () => (
    <p role="status" className="text-muted">
      {REMOVED_NOTE}
    </p>
  ),
};

const BODIES: Record<KindName, Body> = { markdown, image, removed };

// Where a click on a note goes, the same for every kind (ADR 0038, 0040): in a list, a click anywhere on a note's card opens that
// note (components/NoteCard.tsx), so nothing in the card's content links but what its text links to; on a note's own page, an
// attachment opens the attachment's own page.
export function CardContent({ note, imageBase }: { note: Note; imageBase?: string }) {
  const body = BODIES[kindOf(note.type).name];
  const heading = body.heading(note, "card");
  return (
    <>
      {heading && <p className="text-[17px] font-bold tracking-tight">{heading}</p>}
      <body.Content note={note} place="card" imageBase={imageBase} />
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
