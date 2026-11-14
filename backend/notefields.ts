// A note's metadata fields, listed once (conventions: MCP first, one domain layer; shared code lives once). Every surface takes
// them from here: the REST headers of a post and the OpenAPI text for them, the JSON of a PATCH, the MCP tools' inputs, and the
// one check every write path runs. A field added here reaches all of them; backend/mcp.test.ts and notefields.test.ts fail when a
// surface leaves one out.
import { z } from "zod";
import { MAX_ALT } from "../shared/links";
import { decodeHeaderValue } from "../shared/headers";
import { InvalidBodyError } from "./errors";
import { checkLine, MAX_NOTE_TITLE, MAX_SENDER } from "./notes";
import { checkTags, TAG_RULE, tagsFromHeader } from "./tags";

type Kind = "line" | "name" | "tags" | "date" | "draft";
type Field = {
  header: string;
  kind: Kind;
  max?: number;
  rule: string; // what it is, on every surface
  post?: string; // what leaving it out means when posting
  edit?: string; // what an edit does with it
};

const ONE_LINE = "one line (control and text-direction override characters are refused)";
const DATE_RULE = "date must be an ISO 8601 date and time with its offset (2026-10-01T09:30:00Z) or a date (2026-10-01), from 1970 to 9999";

export const NOTE_FIELDS = {
  title: {
    header: "X-Note-Title",
    kind: "line",
    max: MAX_NOTE_TITLE,
    rule: `The note's title: at most ${MAX_NOTE_TITLE} characters, ${ONE_LINE}.`,
    post: "Left out or empty, a markdown note is titled by its text.",
    edit: "Empty removes it: a markdown note's title follows its text again.",
  },
  sender: {
    header: "X-Note-Sender",
    kind: "line",
    max: MAX_SENDER,
    rule: `Who posted the note, as shown on it: at most ${MAX_SENDER} characters, ${ONE_LINE}. Not verified.`,
    post: "It wins over the signed-in name; left out or empty, the signed-in name, if any.",
    edit: "Empty removes it.",
  },
  alt: {
    header: "X-Note-Alt",
    kind: "line",
    max: MAX_ALT,
    rule: `A picture's alternative text: at most ${MAX_ALT} characters, ${ONE_LINE}. For image notes only.`,
    edit: "Empty removes it.",
  },
  name: {
    header: "X-Note-Name",
    kind: "name",
    rule:
      "The note's file name (at most 200 characters; `/`, `\\` and control characters are dropped): for a picture, its original name. " +
      "The read link serves the newest note with that name at `/r/{readId}/{name}`, a stable address for a file that changes " +
      "(a name ending in a lower-case extension, such as `post-to-notefeed.md`); a note's own file name (`<id>.<ext>`) comes first. Not unique.",
  },
  tags: {
    header: "X-Note-Tags",
    kind: "tags",
    rule: `The note's tags (\`ci\`, \`deploy\`): ${TAG_RULE}. Not verified; readers see them.`,
    edit: "The whole new list; empty removes them, left out keeps them.",
  },
  date: {
    header: "X-Note-Date",
    kind: "date",
    rule:
      "The note's date: an ISO 8601 date and time with its offset (`2026-10-01T09:30:00Z`) or a date alone (midnight UTC), from 1970 to 9999. " +
      "The note takes its place in the feed by it; a time after now schedules it: readers see it from then on. Its attachments move with it.",
    post: "Left out or empty: now.",
  },
  draft: {
    header: "X-Note-Draft",
    kind: "draft",
    rule: "A draft: only whoever can post to the feed sees it, readers do not until it is published. Its pictures follow it.",
    post: "Left out or false: published.",
    edit: "false publishes it, true hides it from readers again (refused while a picture of it is the feed's title image); its date stays.",
  },
} as const satisfies Record<string, Field>;

export type NoteField = keyof typeof NOTE_FIELDS;
const ALL = Object.keys(NOTE_FIELDS) as NoteField[];

export type NoteMeta = { title?: string; sender?: string; alt?: string; name?: string; tags?: string[]; date?: string; draft?: boolean };

// The fields' headers of a request: UTF-8 bytes decoded, trimmed, an empty header is none. X-Note-Draft must be true or false.
export function readNoteHeaders(h: Headers, keys: readonly NoteField[] = ALL): NoteMeta {
  const out: NoteMeta = {};
  for (const key of keys) {
    const { header, kind } = NOTE_FIELDS[key] as Field;
    if (kind === "tags") {
      const tags = tagsFromHeader(h.get(header));
      if (tags?.length) out.tags = tags;
      continue;
    }
    const value = decodeHeaderValue(h.get(header) ?? "").trim();
    if (!value) continue;
    if (kind === "draft") {
      const v = value.toLowerCase();
      if (v !== "true" && v !== "false") throw new InvalidBodyError(`${header} must be true or false`);
      out.draft = v === "true";
    } else (out as Record<string, string>)[key] = value;
  }
  return out;
}

const describe = (key: NoteField, use: "post" | "edit", extra = "") => {
  const f = NOTE_FIELDS[key] as Field;
  return [f.rule, f[use] ?? "", extra].filter(Boolean).join(" ");
};

type KindOf<K extends NoteField> = (typeof NOTE_FIELDS)[K]["kind"];
type ZodFor<K extends NoteField> =
  KindOf<K> extends "tags" ? z.ZodOptional<z.ZodArray<z.ZodString>> : KindOf<K> extends "draft" ? z.ZodOptional<z.ZodBoolean> : z.ZodOptional<z.ZodString>;

// The fields as JSON or MCP inputs, each optional: tags a list, draft a boolean, the rest strings.
export function noteFieldSchemas<K extends NoteField>(keys: readonly K[], use: "post" | "edit"): { [P in K]: ZodFor<P> } {
  const shape: Record<string, z.ZodType> = {};
  for (const key of keys) {
    const { kind } = NOTE_FIELDS[key] as Field;
    const base = kind === "tags" ? z.array(z.string()) : kind === "draft" ? z.boolean() : z.string();
    shape[key] = base.optional().describe(describe(key, use));
  }
  return shape as { [P in K]: ZodFor<P> };
}

// The fields as request headers (for the route table and so openapi.json): tags comma-separated, draft `true` or `false`.
export function noteHeaderSchemas(keys: readonly NoteField[], use: "post" | "edit" = "post"): Record<string, z.ZodType> {
  const out: Record<string, z.ZodType> = {};
  for (const key of keys) {
    const { header, kind } = NOTE_FIELDS[key] as Field;
    const extra = kind === "tags" ? "Comma-separated; empty is none." : kind === "draft" ? "" : "Sent as UTF-8; empty is none.";
    out[header] = (kind === "draft" ? z.enum(["true", "false"]).optional() : z.string()).describe(describe(key, use, extra));
  }
  return out;
}

// A note's date: undefined (now) for none, else an ISO 8601 date-time with an offset, or a date alone (midnight UTC). Every field is
// checked against the calendar (Date.parse takes 2026-02-30 and 24:00); from 1970 to the end of 9999 (UTC). A time after now is fine:
// it makes the note scheduled.
const DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?(?:(Z)|([+-])(\d{2}):(\d{2})))?$/;
// The last millisecond of 9999 (UTC): past it, an ISO string needs a six-digit year.
const LAST = Date.UTC(9999, 11, 31, 23, 59, 59, 999);
export function checkDate(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const m = DATE.exec(value);
  if (!m) throw new InvalidBodyError(DATE_RULE);
  const [, y, mo, d, h = "0", mi = "0", s = "0", frac = "", , sign, oh = "0", om = "0"] = m;
  const local = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, frac ? Math.floor(Number(frac) * 1000) : 0));
  const fits =
    local.getUTCFullYear() === +y &&
    local.getUTCMonth() === +mo - 1 &&
    local.getUTCDate() === +d &&
    local.getUTCHours() === +h &&
    local.getUTCMinutes() === +mi &&
    local.getUTCSeconds() === +s;
  if (!fits || +oh > 23 || +om > 59) throw new InvalidBodyError(DATE_RULE);
  const at = new Date(local.getTime() - (sign === "-" ? -1 : 1) * (+oh * 60 + +om) * 60_000);
  if (at.getTime() < 0 || at.getTime() > LAST) throw new InvalidBodyError(DATE_RULE);
  return at;
}

export type CheckedMeta = { title?: string; sender?: string; alt?: string; tags?: string[]; date?: Date };

// Every field given, checked before anything is written: the one-line fields trimmed and held to their length, tags folded, the
// date parsed. What is left out stays undefined. The file name is cleaned where the note is made (cleanName).
export function checkNoteMeta(m: Omit<NoteMeta, "name" | "draft">): CheckedMeta {
  const out: CheckedMeta = {};
  for (const key of ["title", "sender", "alt"] as const) {
    const v = checkLine(key, m[key], NOTE_FIELDS[key].max);
    if (v !== undefined) out[key] = v;
  }
  if (m.tags !== undefined) out.tags = checkTags(m.tags);
  if (m.date !== undefined) out.date = checkDate(m.date);
  return out;
}
