// The kinds of note as the pages and lists tell them apart (ADR 0038): the backend's registry (backend/note/types.ts) by name, with
// what showing a note needs beyond it. Code asks `kindOf(note.type)` instead of testing the media type, so a new type is one entry
// here and one body in components/NoteBody.tsx.
//
// An attachment is a note of its own (ADR 0019, ADR 0021), so a list that shows the note referring to it, with the attachment in
// it, would show the attachment a second time. Lists leave such an attachment out, and the attachment inside the note links to its
// own page instead. Only an attachment whose note is in the same list is left out: a tag filter that lists the attachment alone
// still shows it. The API lists every note.
//
// The references are found with a linear scan, not the markdown parser (whose cost is not bounded by the input's size, see
// shared/imagePlan.mjs): the forms the server itself writes when it swaps a picture's name in (ADR 0021), `![alt](file "title")`,
// `![alt](<file with spaces>)`, percent-encoded names and `[label]: file` definitions. A reference inside a code block counts too;
// that only ever hides a picture that the list would have shown twice or that the text names.
import { isRelativeLink } from "./links";

type Listed = { id: string; type: string; file: string; content?: string };

export type KindName = "markdown" | "image";

export type NoteKind = {
  /** The name of the backend's type (backend/note/types.ts). */
  name: KindName;
  /** The files this note refers to as attachments, as written and decoded, from its text. */
  attachments(content: string | undefined): string[];
  /** Whether a note of this kind can be another note's attachment. */
  attachable: boolean;
  /** Whether its content is text to edit, and whether it has an alternative text. */
  text: boolean;
  alt: boolean;
};

const INLINE = /!\[(?:[^\]\\\n]|\\.)*\]\(\s*(?:<([^>\n]*)>|([^\s)]+))/g;
const DEFINITION = /^ {0,3}\[(?:[^\]\\\n]|\\.)+\]:[ \t]*(?:<([^>\n]*)>|(\S+))/gm;

const decoded = (name: string): string => {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
};

/** The relative names a markdown text refers to, as written and decoded. */
function referencedNames(markdown: string): string[] {
  const names: string[] = [];
  for (const re of [INLINE, DEFINITION]) {
    for (const m of markdown.matchAll(re)) {
      const name = m[1] ?? m[2];
      if (name && isRelativeLink(name)) names.push(name, decoded(name));
    }
  }
  return names;
}

const markdown: NoteKind = { name: "markdown", attachments: (content) => (content ? referencedNames(content) : []), attachable: false, text: true, alt: false };
const image: NoteKind = { name: "image", attachments: () => [], attachable: true, text: false, alt: true };

export const NOTE_KINDS: Record<KindName, NoteKind> = { markdown, image };

/** The kind of a note with this media type: the one place that tells them apart by it. */
export const kindOf = (mediaType: string): NoteKind => (mediaType.startsWith("image/") ? image : markdown);

/** The list without the attachments that another note in it shows. */
export function withoutAttachments<T extends Listed>(notes: T[]): T[] {
  const shown = new Set(notes.flatMap((n) => kindOf(n.type).attachments(n.content)));
  return shown.size ? notes.filter((n) => !(kindOf(n.type).attachable && shown.has(n.file))) : notes;
}

/** For an attachment's name as a note's text writes it: the page of that attachment's note under `base`, when it is in `notes`. */
export function attachmentLinks(notes: Listed[], base: string): (src: string) => string | undefined {
  const byFile = new Map(notes.filter((n) => kindOf(n.type).attachable).map((n) => [n.file, `${base}/${n.id}`]));
  return (src) => (isRelativeLink(src) ? (byFile.get(src) ?? byFile.get(decoded(src))) : undefined);
}
