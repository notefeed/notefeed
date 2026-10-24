import Link from "next/link";
import type { ReactNode } from "react";
import { NoteView } from "@/components/NoteView";
import type { Note } from "@/backend";
import type { KindName } from "@/shared/notekinds";
import { bodyAfterTitle } from "@/shared/notes";

// How each kind of note (shared/notekinds.ts) shows, in a list's card or on its own page (ADR 0038). A body draws content only;
// where a click goes is decided by the card and the page (components/NoteList.tsx): `open` is where the whole content links (in a
// card, the note's own page), `attachmentLink` where an attachment inside it links.
export type Place = "card" | "page";
type ContentProps = { note: Note; place: Place; imageBase?: string; open?: string; attachmentLink?: (src: string) => string | undefined };
type Body = {
  /** The heading above the content, or none: a markdown note's page shows its title in the text. */
  heading(note: Note, place: Place): string | undefined;
  Content(props: ContentProps): ReactNode;
};

// An image note's picture, from the feed's current read link (`imageBase`), so it follows a changed read id. The text alternative is
// the note's own, else its title, else none: a picture without a description is decoration to a screen reader, not a file name.
function Picture({ note, imageBase, className }: { note: Note; imageBase?: string; className: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={(imageBase ?? "") + note.file} alt={note.alt ?? note.title} loading="lazy" className={className} />;
}

const markdown: Body = {
  heading: (note, place) => (place === "card" ? note.title || note.id : undefined),
  Content({ note, place, imageBase, attachmentLink }) {
    if (place === "page") return <NoteView markdown={note.content ?? ""} imageBase={imageBase} link={attachmentLink} />;
    const rest = bodyAfterTitle(note.content ?? "");
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

export const BODIES: Record<KindName, Body> = { markdown, image };
