// For tests only: a markdown note without touching the disk.
import { ImageNote } from "./image";
import { MarkdownNote } from "./markdown";

export const mdNote = ({ id, markdown, date = new Date(0), sender, tags, title }: { id: string; markdown: string; date?: Date; sender?: string; tags?: string[]; title?: string }): MarkdownNote =>
  new MarkdownNote(
    { id, ext: "md", meta: { ...(sender !== undefined && { sender }), ...(tags?.length && { tags }), ...(title !== undefined && { title }) }, date, size: Buffer.byteLength(markdown) },
    markdown,
  );

export const imgNote = ({ id, ext = "png", size = 12, date = new Date(0), title, sender, tags, alt, name }: { id: string; ext?: string; size?: number; date?: Date; title?: string; sender?: string; tags?: string[]; alt?: string; name?: string }): ImageNote =>
  new ImageNote({ id, ext, meta: { ...(sender !== undefined && { sender }), ...(tags?.length && { tags }), ...(title !== undefined && { title }), ...(alt !== undefined && { alt }), ...(name !== undefined && { name }) }, date, size });
