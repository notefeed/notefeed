// The API's wire shapes. Named ones (.meta({ id })) become components of the generated OpenAPI
// document; handlers build their bodies as z.infer of these, and the dispatcher checks them.
import * as z from "zod";
import { ERROR_CODES } from "../../shared/errors";
import { PASSWORD_RULE } from "../../shared/password";
import { FEED_RE } from "../feeds";
import { MAX_ATTACHMENTS } from "../posting";
import { TAG_RE, TAG_RULE } from "../tags";

export const NOTE_ID = /^[A-Za-z0-9_-]{1,128}$/;
export const MAX_LIMIT = 100;

export const NoteJson = z
  .object({
    id: z.string().regex(NOTE_ID).describe("The note's id: 22 random characters (base64url) for notes made here, older notes may have another form; any name without a dot for a file placed by hand. It says nothing about the note's date"),
    type: z.string().describe("The media type of the note's file: `text/markdown`, `image/png`, `image/jpeg`, `image/gif` or `image/webp`"),
    file: z.string().describe("The note's file name, `<id>.<extension>`"),
    file_url: z.url().nullable().describe("Where the note's file is served, absolute, under the feed's read id (public like the read link); null while the feed has no read link"),
    size: z.number().int().describe("The size of the note's file in bytes"),
    title: z.string().describe("The title set for the note, else the first heading or the first non-empty line of a markdown note, else the picture's alt text; may be empty"),
    content: z.string().optional().describe("The note's text, byte-for-byte as posted: for a text type (markdown) only; absent for a picture"),
    alt: z.string().optional().describe("Alternative text of an image note, when it has one"),
    name: z.string().optional().describe("The file name an image was posted with, when it came with one"),
    date: z.iso.datetime().describe("Where the note is placed in the feed (UTC): when it was posted, unless a date was given or changed; lists are ordered by it"),
    scheduled: z.literal(true).optional().describe("Present, and true, when the note's date is after now: it is stored, and readers see it from its date on. Absent for every other note"),
    url: z.url().describe("The note's page in the web UI"),
    sender: z.string().nullable().optional().describe("Verified sign-in name of the poster; absent when the note was posted without a sign-in"),
    tags: z.array(z.string()).describe("Labels the poster gave the note (not verified, and shown to readers like the note itself); empty when none"),
    unreadable: z
      .literal(true)
      .optional()
      .describe("Present, and true, for a damaged note: its stored copy can't be decrypted. A list shows it in its place, with its id, file, type and time; its title and tags are empty, its size 0, it has no content, and reading it alone is a 500 with the code `unreadable`. Deleting it works. Absent for every other note"),
  })
  .meta({ id: "Note" });
export type NoteJson = z.infer<typeof NoteJson>;

export const NoteList = z
  .object({
    notes: z.array(NoteJson).describe("Newest first"),
    next: z.string().nullable().describe("Pass as `before` for the next (older) page; null on the last page"),
  })
  .meta({ id: "NoteList" });

export const Created = z
  .object({
    id: z.string().regex(NOTE_ID),
    url: z.url().describe("The note's page in the web UI"),
    feed_url: z.url().describe("The feed's page in the web UI"),
    read_url: z.url().nullable().describe("The feed's read-only RSS link, safe to share; null only if the server can't read the feed's stored read id, or if that id and the derived one both belong to other feeds"),
    file: z.string().describe("The note's file name, `<id>.<extension>`. For an image note, pass it as a feed's `image` setting"),
    file_url: z.url().nullable().describe("Where the note's file is served, absolute, under the feed's read id (public like the read link); null while the feed has no read link"),
  })
  .meta({ id: "Created" });
export type Created = z.infer<typeof Created>;

const Attachments = z.array(Created).optional().describe("A multipart request's pictures, one per `file` part, in their order; absent for a raw body");
export const Posted = Created.extend({ attachments: Attachments }).describe("The note the post is about: its text note, or with no `text` part its first picture").meta({ id: "Posted" });
export type Posted = z.infer<typeof Posted>;
export const NoteEdited = NoteJson.extend({ attachments: Attachments }).meta({ id: "NoteEdited" });

// A note with its pictures, as multipart/form-data. `alt.<file name>` fields can't be listed by name: they are described in text.
export const MultipartNote = z
  .object({
    text: z.string().optional().describe("The markdown note (UTF-8): a field, or a file part (its name is ignored; its type, if any, `text/markdown` or `application/octet-stream`) to keep its line breaks as they are, since a form field's are sent as CRLF. At most one; required on a PUT. Its references to the files (`![](chart.png)`, `[x]: chart.png`) are swapped for the stored files; a file it never refers to is appended as `![](file)`"),
    file: z
      .array(z.string().meta({ format: "binary" }))
      .max(MAX_ATTACHMENTS)
      .optional()
      .describe(`A picture: up to ${MAX_ATTACHMENTS} parts, each with a file name (one path segment, 1 to 200 characters, unique in the request) and its image \`Content-Type\`. An \`alt.<file name>\` field gives one its alternative text`),
  })
  .meta({ id: "MultipartNote" });

export const ErrorJson = z
  .object({
    error: z.string().describe("A short reason, for people"),
    code: z.enum(ERROR_CODES).optional().describe("Stable machine-readable code; absent only on a 500"),
  })
  .meta({ id: "Error" });

const NoteTitle = z.string().describe("The note's title, at most 100 characters, one line (control and text-direction override characters are refused); empty or left out means the title is taken from the text (a markdown note) or there is none (an image)");
const NoteAlt = z.string().describe("Alternative text of an image note, at most 500 characters, one line (control and text-direction override characters are refused)");
const DATE_FORMAT = "An ISO 8601 date and time with its offset (`2026-10-01T09:30:00Z`, `2026-10-01T11:30:00+02:00`) or a date alone (midnight UTC). ";
const DATE_RULE = "When the note is placed in the feed, from 1970 to 9999. A time after now schedules it: readers see it from then on.";
const NoteDate = z.string().describe(`${DATE_FORMAT}${DATE_RULE} The note's attachments move with it.`);
export const MetaJson = z
  .object({
    title: NoteTitle.optional(),
    alt: NoteAlt.optional(),
    tags: z.array(z.string()).optional().describe(`The note's tags, the whole new list (\`["ci","done"]\`): ${TAG_RULE}. Empty removes them all; omitted leaves them as they are.`),
    date: NoteDate.optional(),
  })
  .meta({ id: "NoteMeta" });
export const PasswordJson = z.object({ password: z.string().describe(`The new password: ${PASSWORD_RULE}`) }).meta({ id: "PasswordJson" });
export const CreateFeedJson = z
  .object({
    password: z.string().optional().describe(`A password that protects the new feed: ${PASSWORD_RULE}. Empty or left out: an open feed`),
    license_key: z.string().optional().describe("Where licenses are sold, required: the key of the license to put on the new feed"),
    read_id: z.string().optional().describe("The read id to give the feed (3 to 64 characters of a-z, 0-9, - and _); left out: a random one"),
  })
  .meta({ id: "CreateFeedJson" });
export const LicenseKeyJson = z.object({ key: z.string().describe("The license key, as the checkout or the receipt gave it") }).meta({ id: "LicenseKey" });

export const FeedPasswordHeader = z
  .string()
  .describe(
    "The feed's own password, when it has one: to post, list or get, and (as the current password) to change or remove it. " +
      "On the `POST` that creates a feed it sets the feed's password; on a `POST` to an existing feed that has none it answers 409. " +
      "An empty value is the same as no header, so a `POST` with an empty one creates an open feed.",
  );
export const NoteTagsHeader = z
  .string()
  .describe(`Tags for the note, comma-separated (\`ci,deploy\`): ${TAG_RULE}. For a raw markdown body; a JSON or form body's own \`tags\` wins. Empty is none.`);
export const NoteTitleHeader = NoteTitle.describe("The note's title, for a raw body; a JSON or form body's own `title` wins. At most 100 characters, one line, with no control or text-direction override characters.");
export const NoteDateHeader = z.string().describe(`${DATE_FORMAT}${DATE_RULE} Empty is now.`);
export const NoteAltHeader = NoteAlt.describe("For an image body: its alternative text; a form's own `alt` wins.");
export const ReadIdHeader = z.string().describe("The read id the feed gets when this post creates it: 3 to 64 characters (a-z, 0-9, - and _), random when left out or empty, ignored for a feed that exists. A short readable one is guessable: protect the feed with a password if that matters. 409 when it is taken");
export const LicenseKeyHeader = z
  .string()
  .describe(
    "Only on an instance that sells licenses, on the post that creates the feed: the key of the license to put on the new feed, with or without `X-Feed-Password` " +
      "(a feed password is for licensed feeds: with one and no key, 402). 400 for a key that is none, 402 for one whose license has lapsed; either way nothing is created. " +
      "Ignored on an existing feed: put a license on it with `PUT /api/v1/feeds/{feed}/license`",
  );
export const NoteNameHeader = z
  .string()
  .describe(
    "The note's file name (at most 200 characters; `/`, `\\` and control characters are dropped): for a picture, its original name. The read link serves the newest note with that name at `/r/{readId}/{name}`, " +
      "a stable address for a file that changes (a name ending in a lower-case extension, such as `post-to-notefeed.md`); a note's own file name (`<id>.<ext>`) comes first",
  );
export const CurrentPasswordHeader = z.string().describe("The feed's current password");

const TITLE = z.string().describe("Display title, at most 100 characters, one line (control and text-direction override characters are refused); empty means none (the feed's name is shown)");
const DESCRIPTION = z.string().describe("Description, at most 500 characters, one line (control and text-direction override characters are refused); may be empty");
const IMAGE_URL = z.url().nullable().describe("The feed's title image (absolute URL, served under the read id), or null");
export const FeedSettingsJson = z
  .object({
    title: TITLE,
    description: DESCRIPTION,
    image: z
      .string()
      .optional()
      .describe("The file name of an image uploaded to this feed (see uploadImage), shown as the feed's title image; empty removes it, omitted leaves it as it is"),
    show_sender: z.boolean().optional().describe("Whether readers (RSS, the read API and pages) see who posted each note; omitted leaves it as it is, a new feed starts with true"),
    read_id: z
      .string()
      .optional()
      .describe("A new read id (3 to 64 characters: a-z, 0-9, - and _), empty for a random one; omitted leaves it as it is. The old read link stops showing this feed, and may later show another one. Notes are not edited: a relative image link (`![](file)`) follows the new id, a full URL keeps the old one and is yours to change. Reserved feeds keep theirs. 409 when it is taken"),
  })
  .meta({ id: "FeedSettings" });
export const FreeTierJson = z
  .object({
    notes: z.number().int().describe("The feed's text notes now"),
    cap: z.number().int().describe("How many text notes a free feed keeps; past it, each new note drops the oldest one"),
  })
  .meta({ id: "FreeTier" });
export const FeedJson = z
  .object({
    name: z.string().describe("The feed's name"),
    title: TITLE,
    description: DESCRIPTION,
    protected: z.boolean().describe("Whether the feed has its own password"),
    read_url: z.url().nullable().describe("The feed's read-only RSS link; null while the feed has no notes, or if the server can't read the feed's stored read id"),
    image_url: IMAGE_URL,
    show_sender: z.boolean().describe("Whether readers see who posted each note"),
    free_tier: FreeTierJson.nullable().describe(
      "A feed without a license on an instance that sells them: its notes against the free tier's cap. null when no cap applies (a licensed feed, or an instance that sells no licenses)",
    ),
  })
  .meta({ id: "Feed" });
export const ReadFeedJson = z.object({ title: TITLE, description: DESCRIPTION, image_url: IMAGE_URL }).meta({ id: "ReadFeed" });

// A raw request body, not JSON.
export const FileBody = z.string().meta({ format: "binary" }).describe("The note, a file: its bytes, of the type `Content-Type` declares");

export const COMPONENTS = [NoteJson, NoteList, Created, Posted, NoteEdited, MultipartNote, ErrorJson, MetaJson, PasswordJson, CreateFeedJson, LicenseKeyJson, FeedSettingsJson, FreeTierJson, FeedJson, ReadFeedJson];

export const FeedParam = z.string().regex(FEED_RE).describe("The feed's name. It is the write key: anyone who knows it can post.");
export const ReadIdParam = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).describe("The feed's read id, from its read link: 22 random characters, one the feed's owner chose, or the feed's own name for a reserved feed. Read-only; never reveals the name of any other feed.");
export const NoteIdParam = z.string().regex(NOTE_ID).describe("The note's id");

export const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(50).describe(`Notes per page, 1–${MAX_LIMIT}`),
  before: z.string().regex(NOTE_ID).optional().describe("Only notes older than this id: the previous page's `next`"),
  tag: z.string().toLowerCase().pipe(z.string().regex(TAG_RE)).optional().describe("Only notes carrying this tag"),
});
