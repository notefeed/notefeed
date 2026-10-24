// A picture posted with a markdown note is a note of its own (ADR 0019, ADR 0021), so a list that shows the markdown note, with the
// picture in it, would show the picture a second time as its own note. Lists leave such a picture out, and the picture in the
// markdown note links to the picture's own page instead. Only a picture whose showing note is in the same list is left out: a tag
// filter that lists the picture alone still shows it. The API lists every note.
//
// The references are found with a linear scan, not the markdown parser (whose cost is not bounded by the input's size, see
// shared/imagePlan.mjs): the forms the server itself writes when it swaps a picture's name in (ADR 0021), `![alt](file "title")`,
// `![alt](<file with spaces>)`, percent-encoded names and `[label]: file` definitions. A reference inside a code block counts too;
// that only ever hides a picture that the list would have shown twice or that the text names.
import { isRelativeLink } from "./links";

type Listed = { id: string; type: string; file: string; content?: string };

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

const isPicture = (n: Listed) => n.type.startsWith("image/");

/** The list without the pictures that a markdown note in it shows. */
export function withoutShownPictures<T extends Listed>(notes: T[]): T[] {
  const shown = new Set(notes.filter((n) => !isPicture(n) && n.content).flatMap((n) => referencedNames(n.content!)));
  return shown.size ? notes.filter((n) => !(isPicture(n) && shown.has(n.file))) : notes;
}

/** For a picture's name as a markdown text writes it: the page of that picture's note under `base`, when it is in `notes`. */
export function pictureLinks(notes: Listed[], base: string): (src: string) => string | undefined {
  const byFile = new Map(notes.filter(isPicture).map((n) => [n.file, `${base}/${n.id}`]));
  return (src) => (isRelativeLink(src) ? (byFile.get(src) ?? byFile.get(decoded(src))) : undefined);
}
