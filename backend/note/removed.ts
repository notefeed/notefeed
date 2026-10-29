// The mark the operator leaves where a post was removed (issue #159, ADR 0052): in the post's place, with its id and its date, and
// nothing of what it was. Its owner can delete it like any note; it can't be posted or edited, and the post does not come back.
import { REMOVED_NOTE } from "../../shared/notekinds";
import { Note } from "./note";

export class RemovedNote extends Note {
  override get removed(): boolean {
    return true;
  }
  get content(): undefined {
    return undefined;
  }
  get title(): string {
    return "";
  }
  rssContent() {
    return { description: `<p>${REMOVED_NOTE}</p>` }; // a constant, nothing to escape
  }
  withMeta(): this {
    return this;
  }
}
