import { cleanLine } from "../../shared/links";
import { imageType, markdownToHtml } from "../rsshtml";
import { extractTitle } from "../../shared/notes";
import type { Meta } from "../storage/types";
import { EmptyNoteError, NoteTooLargeError } from "../errors";
import { Note, type NoteInit, type RssContent } from "./note";

export const MAX_BYTES = 102400;

// Storage only: no auth, rate limit or caps (that is posting.ts).
export function checkMarkdown(markdown: string): void {
  if (markdown.trim() === "") throw new EmptyNoteError();
  if (Buffer.byteLength(markdown, "utf8") > MAX_BYTES) throw new NoteTooLargeError();
}

export class MarkdownNote extends Note {
  readonly markdown: string;

  constructor(init: NoteInit, markdown: string) {
    super(init);
    this.markdown = markdown;
  }

  get content(): string {
    return this.markdown;
  }
  get title(): string {
    return cleanLine(this.meta.title ?? extractTitle(this.markdown)); // what no title holds is not shown, whatever was stored or written in the text
  }
  // The text as HTML, its pictures absolute (backend/rsshtml.ts); the first picture also as the item's image.
  rssContent(base: string): RssContent {
    const { html, image } = markdownToHtml(this.markdown, `${base}/`);
    const type = image && imageType(image);
    return { description: html, ...(image && type && { image: { url: image, type } }) };
  }
  withMeta(meta: Meta): MarkdownNote {
    return new MarkdownNote({ id: this.id, ext: this.ext, meta, date: this.date, size: this.size }, this.markdown);
  }
}
