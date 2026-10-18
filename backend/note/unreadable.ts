// A note whose stored copy can't be decrypted (encryption at rest, issue #212), as a list shows it: in its place, with what is known
// without reading it (its id, its file, its time from the id). Never its content, title or tags, which are what could not be read.
import { Note } from "./note";

export class UnreadableNote extends Note {
  constructor(id: string, ext: string, createdAt: Date) {
    super({ id, ext, meta: {}, createdAt, size: 0 });
  }
  override get unreadable(): boolean {
    return true;
  }
  get content(): undefined {
    return undefined;
  }
  get title(): string {
    return "";
  }
  rssContent() {
    return {};
  }
  withMeta(): this {
    return this;
  }
}
