// One-off (ADR 0063): moves a feed's `lang:` tags into the notes' language field, through the REST API.
//
//   node scripts/move-lang-tags.mts --url https://notefeed.me --feed 3dbruckner [--apply]
//
// The feed's password goes in NOTEFEED_FEED_PASSWORD, the instance password or an account token (when the instance needs one) in
// NOTEFEED_TOKEN. Without --apply it only lists the notes it would change. With --apply it sends each such note's own tags back in a
// PATCH: the server keeps the other tags and moves a single valid `lang:` tag into the language (backend/notefields.ts,
// languageFromTags); a note with two of them, or a value the field refuses, keeps the tag, and the script says so.
// Through the API rather than storage: it runs from anywhere against any instance, encrypted storage included, with no server access.
import { parseArgs } from "node:util";

type Note = { id: string; title: string; tags: string[]; language?: string };

const { values } = parseArgs({ options: { url: { type: "string" }, feed: { type: "string" }, apply: { type: "boolean" } } });
if (!values.url || !values.feed) {
  console.error("usage: node scripts/move-lang-tags.mts --url URL --feed FEED [--apply]");
  process.exit(2);
}
const base = `${values.url.replace(/\/$/, "")}/api/v1/feeds/${encodeURIComponent(values.feed)}/notes`;
const headers: Record<string, string> = {
  ...(process.env.NOTEFEED_TOKEN && { Authorization: `Bearer ${process.env.NOTEFEED_TOKEN}` }),
  ...(process.env.NOTEFEED_FEED_PASSWORD && { "X-Feed-Password": process.env.NOTEFEED_FEED_PASSWORD }),
};

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...headers, ...init.headers } });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${url}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

const moves = (tags: string[]) => tags.filter((t) => t.startsWith("lang:"));

let found = 0;
let kept = 0;
for (let before: string | null = null, first = true; first || before; first = false) {
  const page: { notes: Note[]; next: string | null } = await call(`${base}?limit=100${before ? `&before=${encodeURIComponent(before)}` : ""}`);
  for (const note of page.notes) {
    const tagged = moves(note.tags);
    if (!tagged.length) continue;
    found++;
    if (!values.apply) {
      console.log(`${note.id}  ${note.title}  ${tagged.join(", ")}`);
      continue;
    }
    const after: Note = await call(`${base}/${encodeURIComponent(note.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: note.tags }),
    });
    const left = moves(after.tags);
    if (left.length) kept++;
    console.log(`${note.id}  language=${after.language ?? "-"}${left.length ? `  kept as tags: ${left.join(", ")}` : ""}`);
  }
  before = page.next;
}
console.log(values.apply ? `${found} notes sent, ${kept} kept a lang: tag` : `${found} notes would change; run again with --apply`);
