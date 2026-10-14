import { notFound } from "next/navigation";
import { NoteView } from "@/components/NoteView";
import { card } from "@/components/styles";
import { readLegalPage, type LegalPage as Which } from "@/backend";

// The operator's own imprint or privacy page: their Markdown file, shown like a note (raw HTML stays text). notefeed
// ships no such text, so without a file there is no page. Shown as a document on a card (.doc in globals.css).
export async function LegalPage({ which }: { which: Which }) {
  const markdown = await readLegalPage(which);
  if (markdown === null) notFound();
  return (
    <main>
      <article className={`${card} doc p-5 sm:p-8`}>
        <NoteView markdown={markdown} />
      </article>
    </main>
  );
}
