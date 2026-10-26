// A comma-separated list of tags as typed in a form: up to 10, each 1 to 32 letters, digits, `-`, `_`, `.` or `:`.
// An HTML `pattern` (which the browser anchors itself); the backend (backend/tags.ts) is the real check and also folds case.
export const TAGS_PATTERN = "\\s*([A-Za-z0-9_.:\\-]{1,32}\\s*(,\\s*[A-Za-z0-9_.:\\-]{1,32}\\s*){0,9})?";
export const TAGS_HINT = "Up to 10 tags, separated by commas, each 1 to 32 letters, digits, - _ . or :";

// Numbers within a name compare as numbers, so v0.9.1 comes before v0.10.0 (#241).
const byName = new Intl.Collator(undefined, { numeric: true });

// The tags of these notes, most used first, then by name: the filter in a feed's details.
export function sortTags(notes: { tags: string[] }[]): string[] {
  const counts = new Map<string, number>();
  for (const n of notes) for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].sort((x, y) => y[1] - x[1] || byName.compare(x[0], y[0])).map(([t]) => t);
}
