// A feed's settings as stored by every backend: JSON text, `{ "title", "description", "image" }` plus `"showSender": false` only when
// false (absent reads as true, so a file from before sign-in stays as it was) and `"ownImage": true` only when true. Absent or
// unreadable means empty.
import type { Settings } from "./types";

const EMPTY: Settings = { title: "", description: "", image: "", showSender: true };

export function parseSettings(text: string | null): Settings {
  try {
    const j = JSON.parse(text ?? "");
    const image = typeof j.image === "string" ? j.image : "";
    return { title: typeof j.title === "string" ? j.title : "", description: typeof j.description === "string" ? j.description : "", image, showSender: j.showSender !== false, ...(j.ownImage === true && image && { ownImage: true }) };
  } catch {
    return { ...EMPTY };
  }
}

export function serializeSettings(s: Settings): string {
  const { showSender, ownImage, ...rest } = s;
  return JSON.stringify({ ...rest, ...(!showSender && { showSender }), ...(ownImage && { ownImage }) });
}
