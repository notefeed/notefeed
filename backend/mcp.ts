// The MCP endpoint: POST /mcp, protocol 2026-07-28 only, nine tools over the same backend the HTTP API uses.
import { changeUnits, licenseOf, startCheckout } from "./licenseflow";
import { licensingOn, requireLicensesSold } from "./licensing";
import { AccountLicenseJson } from "./http/schemas";
import { checkNoteMeta, noteFieldSchemas, type NoteMeta } from "./notefields";
import { McpServer, createMcpHandler, type AuthInfo } from "@modelcontextprotocol/server";
import * as z from "zod";
import { bearerOf, checkBearer, locked, safeEqual } from "./auth";
import { config } from "./config";
import { AuthError, ImageTooLargeError, InvalidBodyError, NotefeedError, NotFoundError, TooManyAttemptsError, UnsupportedTypeError } from "./errors";
import { addFeedPassword, changePassword, checkFeedAccess, claimFeed, listFeedPasswords, ownedFeeds, revokeFeedPassword } from "./feedlock";
import { createAccountToken, listAccountTokens, revokeAccountToken } from "./accounts/tokens";
import { assertFeed, FEED_RE, hasFeed } from "./feeds";
import { feedJson, licensesJson } from "./http/api";
import { ownerFile } from "./http/files";
import { accountName, instanceUser, oauthAuth, stillAllowed, type Auth } from "./accounts/auth";
import { accountsOn } from "./accounts/mode";
import { requireMcpAuth } from "@better-auth/mcp";
import type { JWTPayload } from "jose";
import { FeedJson, FreeTierJson, LicensesJson } from "./http/schemas";
import { clientIp } from "./limits";
import { runningVersion } from "./version";
import { ACCEPTED_TYPES } from "./note/media";
import { parseMediaType } from "./note/types";
import { logger } from "./log";
import * as next from "./mcpguidance";
import { getNote, isDraft, isScheduled, listNotes, refuseRemovedNote, type Note } from "./notes";
import { MAX_REQUEST_BYTES } from "../shared/images";
import { isAttachmentName, safeName } from "../shared/links";
import { createFeed, deleteFeed, setFeedImage, deleteNote, editContent, editMeta, postNote, postWithPictures, setFeedCovered, updateFeed } from "./posting";
import { getStoredSettings } from "./feedsettings";
import { atomPath, feedPath, imagePath, mcpResource, publicUrl, rssPath } from "./urls";

const log = logger("mcp");
const SECRET_NOTE = "The feed name works like a password: anyone who knows it can read and post. Don't repeat it in replies.";

const feed = z.string().regex(FEED_RE);
const password = z.string().optional();
const PROTECTED = "A protected feed needs its password as password.";
// Every picture is processed on the server (ADR 0049): an assistant should send the file it has, not shrink it first.
const PICTURES =
  "Send a picture as it is, full size (up to 10 MiB, 100 megapixels): it is stored turned upright, at most 2560 px on its long side and without metadata (EXIF, GPS position). If the server answers busy, try again after a few seconds.";
// Drafts (#265): what a post takes, and what its answer says.
const DRAFT_OUT = z.literal(true).optional().describe("Only present when the note was stored as a draft");
const NoteSummary = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  date: z.string().describe("The note's date: where it sits in the feed, and when readers see it"),
  scheduled: z.literal(true).optional().describe("Only present for a note dated in the future: readers do not see it until then"),
  draft: z.literal(true).optional().describe("Only present for a draft: readers do not see it until it is published with edit_note's draft false"),
  url: z.string(),
  sender: z.string().optional(),
  tags: z.array(z.string()),
  unreadable: z
    .literal(true)
    .optional()
    .describe("A damaged note: its stored copy can't be decrypted, so its title and tags are empty and get_note refuses it. It can be deleted"),
  removed: z
    .literal(true)
    .optional()
    .describe(
      "The mark the operator left where a post was removed for breaking the content rules: it has the removed note's id and date and nothing else; get_note and edit_note refuse it. Deleting it works; the post does not come back",
    ),
});
const NoteFull = NoteSummary.extend({ content: z.string().optional() }); // the text of a text type; a picture has none

// What to tell the user or do next, worked out from what the call did (#357): in every tool's result, where a client that drops
// the tool descriptions still sees it.
const GUIDANCE = z.array(z.string()).describe("What to tell the user or do next, worked out from what this call did: short instructions, in order");
const NoteOut = NoteFull.extend({ guidance: GUIDANCE });
const Deleted = z.object({ deleted: z.literal(true), guidance: GUIDANCE });

// A tool result: the body as structured content and, for clients that only read text, as JSON text.
const ok = <T extends object>(body: T) => ({ structuredContent: body, content: [{ type: "text" as const, text: JSON.stringify(body) }] });

// NotefeedErrors are refusals the model can read. The SDK turns any other throw into a tool error carrying its
// message (an ENOENT would leak a path), so those are logged here and the client only gets "internal error".
function guard<A, R>(f: (args: A) => Promise<R>) {
  return async (args: A) => {
    try {
      return await f(args);
    } catch (e) {
      if (e instanceof NotefeedError) return { isError: true as const, content: [{ type: "text" as const, text: e.message }] };
      log.error({ err: e }, "tool failed");
      return { isError: true as const, content: [{ type: "text" as const, text: "internal error" }] };
    }
  };
}

// Every tool declares all four hints, as booleans: directories such as OpenAI's refuse a tool that leaves one out. Only get_licenses
// reaches beyond this notefeed: its plans come from the payment provider.
function server(h: Headers, account: string | undefined): McpServer {
  // `account`: the one the client signed in as (#390, ADR 0062), from its Better Auth access token, checked by the gate on every
  // request; else none. Its sender name is its identity provider's (a number account has none).
  const sender = async () => (account ? await accountName(account) : undefined);
  const needAccount = (): string => {
    if (!account) throw new AuthError("sign in with an account first: connect this MCP client again and choose your account on the authorize page");
    return account;
  };
  const base = publicUrl(h);
  const summary = (feed: string, n: Note) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    date: n.date.toISOString(),
    ...(isScheduled(n) && { scheduled: true as const }),
    ...(isDraft(n) && { draft: true as const }),
    url: `${base}${feedPath(feed)}/${n.id}`,
    ...(n.sender !== undefined && { sender: n.sender }),
    tags: n.tags,
    ...(n.unreadable && { unreadable: true as const }),
    ...(n.removed && { removed: true as const }),
  });
  // A reserved name must not reach the filesystem lookup, so it is checked first.
  const checkAccess = async (feed: string, password?: string) => {
    assertFeed(feed);
    await checkFeedAccess(feed, { password, account }, clientIp(h));
  };
  const state = (n: Note) => ({ draft: isDraft(n), scheduled: isScheduled(n), date: n.date.toISOString() });
  const feedGuidance = (f: z.infer<typeof FeedJson>) => ({ readUrl: f.read_url, protected: f.protected, freeTier: f.free_tier });
  const s = new McpServer({ name: "notefeed", version: runningVersion().version }); // the instance's version (#306)

  // One file as a note: the type must be accepted and the bytes must be what it says (postNote checks that); a picture is size-limited.
  const postBytes = async (feed: string, f: { type: string; data: string } & NoteMeta, password: string | undefined) => {
    const { type, data, ...meta } = f;
    const parsed = parseMediaType(type);
    if (!parsed) throw new UnsupportedTypeError();
    const body = Buffer.from(data, "base64");
    if (parsed.type.name === "image" && body.length > config.maxImageBytes()) throw new ImageTooLargeError();
    return postNote(feed, clientIp(h), async () => ({ ...meta, body, mediaType: parsed.mediaType }), { password, account }, await sender());
  };
  const fileUrl = (readId: string | null, file: string) => (readId ? base + imagePath(readId, file) : "");

  s.registerTool(
    "post_note",
    {
      description: `Post a markdown note to a feed; the feed is created by its first note; a password given then protects the feed for good, and is refused on a feed that already exists. attachments are pictures posted with the note, each as a note of its own: write ![](name) in the markdown where one goes (a name with spaces as ![](<name with spaces>) or ![](name%20with%20spaces); a title after it is fine; an attachment the text never refers to is added at the end); all or nothing, a refusal posts nothing. ${PICTURES} ${PROTECTED} ${SECRET_NOTE}`,
      inputSchema: z.object({
        feed,
        markdown: z.string(),
        ...noteFieldSchemas(["title", "sender", "name", "tags", "date", "draft"], "post"),
        password,
        read_id: z
          .string()
          .optional()
          .describe(
            "Only when this post creates the feed: its read id (3 to 64 characters of a-z, 0-9, - and _), random when left out. A short readable one is guessable. Fails if taken.",
          ),
        attachments: z
          .array(
            z.object({
              name: z
                .string()
                .refine(
                  isAttachmentName,
                  "Not a file name: 1 to 200 characters, no / or \\, no control or text-direction override characters, no leading or trailing space, not only dots",
                )
                .describe(
                  "What the markdown calls it: ![](name). Any single path segment (no / or \\; spaces allowed, written <name with spaces> or name%20with%20spaces in the markdown); unique when the markdown refers to it, else pictures of the same name are appended",
                ),
              type: z.string().describe(`The picture's media type: ${ACCEPTED_TYPES}`),
              data: z.string().describe("The picture's bytes, standard base64 (not URL-safe)"),
              alt: z
                .string()
                .optional()
                .describe("Alternative text (at most 500 characters, one line; control and text-direction override characters are refused)"),
            }),
          )
          .optional(),
      }),
      outputSchema: z.object({
        id: z.string(),
        url: z.string(),
        feed_url: z.string(),
        read_url: z.string().nullable(),
        atom_url: z.string().nullable(),
        draft: DRAFT_OUT,
        attachments: z.array(z.object({ id: z.string(), file: z.string(), url: z.string() })),
        guidance: GUIDANCE,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    guard(async ({ feed, markdown, title, sender: given, name, password, tags, date, draft, read_id, attachments = [] }) => {
      // Buffer.from skips what is not base64, so the data is checked here; the rest of the checks are postWithPictures's.
      const pictures = attachments.map((a) => {
        const clean = a.data.replace(/\s/g, "");
        const body = Buffer.from(clean, "base64");
        if (body.toString("base64").replace(/=+$/, "") !== clean.replace(/=+$/, ""))
          throw new InvalidBodyError(`attachment "${safeName(a.name)}": data is not valid base64`);
        return { name: a.name, body, mediaType: a.type, alt: a.alt };
      });
      const existed = await hasFeed(feed); // only for the guidance: whether this post created the feed
      const {
        note,
        readId,
        pictures: stored,
      } = await postWithPictures(
        feed,
        clientIp(h),
        async () => ({ text: markdown, pictures, title, sender: given, name, tags, date, draft, password, readId: read_id }),
        { password, account },
        await sender(),
      );
      const feedUrl = base + feedPath(feed);
      const url = `${feedUrl}/${note.id}`;
      const readUrl = readId && base + rssPath(readId);
      return ok({
        id: note.id,
        url,
        feed_url: feedUrl,
        read_url: readUrl,
        atom_url: readId && base + atomPath(readId),
        ...(note.draft && { draft: true as const }),
        attachments: stored.map((p) => ({ id: p.id, file: p.file, url: fileUrl(readId, p.file) })),
        guidance: next.afterPost({ ...state(note), url, readUrl, created: !existed, attachments: stored.length }),
      });
    }),
  );

  s.registerTool(
    "list_notes",
    {
      description: `List a feed's notes, newest first, without their content. Pass the returned next as before for the next page. ${PROTECTED} ${SECRET_NOTE}`,
      inputSchema: z.object({
        feed,
        limit: z.number().int().min(1).max(100).default(20),
        before: z.string().optional(),
        tag: z.string().optional().describe("Only notes carrying this tag"),
        password,
      }),
      outputSchema: z.object({ notes: z.array(NoteSummary), next: z.string().nullable(), guidance: GUIDANCE }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guard(async ({ feed, limit, before, tag, password }) => {
      await checkAccess(feed, password);
      const found = await listNotes(feed, limit + 1, before, tag?.toLowerCase(), undefined, true); // one extra: is there a next page?
      const shown = found.slice(0, limit);
      const nextId = found.length > limit ? shown[shown.length - 1].id : null;
      const guidance = next.afterList({
        next: nextId,
        drafts: shown.filter((n) => isDraft(n)).length,
        scheduled: shown.filter((n) => isScheduled(n)).length,
        shown: shown.length,
      });
      return ok({ notes: shown.map((n) => summary(feed, n)), next: nextId, guidance });
    }),
  );

  s.registerTool(
    "get_note",
    {
      description: `Get one note with its content (the text of a text note; a picture has none: its URL is public once readers may see it, and with picture true the picture itself comes along, also a draft's or a scheduled note's, which the URL does not serve yet). ${PROTECTED} ${SECRET_NOTE}`,
      inputSchema: z.object({
        feed,
        id: z.string(),
        picture: z
          .boolean()
          .optional()
          .describe("true: a picture note's image comes along as an image, so a draft's pictures can be checked before it goes out. Ignored for a text note"),
        password,
      }),
      outputSchema: NoteOut,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guard(async ({ feed, id, picture, password }) => {
      await checkAccess(feed, password);
      await refuseRemovedNote(feed, id);
      const note = await getNote(feed, id);
      if (!note) throw new NotFoundError("no such note");
      const result = ok({ ...summary(feed, note), ...(note.content !== undefined && { content: note.content }), guidance: next.afterGetNote(state(note)) });
      if (!picture || !note.type.startsWith("image/")) return result;
      // The owner's view of the file (#349): drafts and scheduled notes too.
      const file = await ownerFile(feed, note.file, null, "throw");
      if (file.status !== 200) throw new NotFoundError("no such note");
      const data = Buffer.from(await file.arrayBuffer()).toString("base64");
      return { ...result, content: [...result.content, { type: "image" as const, data, mimeType: note.type }] };
    }),
  );

  s.registerTool(
    "edit_note",
    {
      description: `Replace a note's markdown, set its title, its tags, its date or whether it is a draft, or any of them (an empty title removes it: the title follows the text again; tags replace the whole list, an empty one removes them; a future date schedules the note; draft false publishes a draft, draft true hides a note from readers again); its id stays. At least one of markdown, title, sender, tags, date and draft. ${PROTECTED} ${SECRET_NOTE}`,
      inputSchema: z.object({
        feed,
        id: z.string(),
        markdown: z.string().optional(),
        ...noteFieldSchemas(["title", "sender", "tags", "date", "draft"], "edit"),
        password,
      }),
      outputSchema: NoteOut,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    guard(async ({ feed, id, markdown, title, sender: given, tags, date, draft, password }) => {
      if (markdown === undefined && title === undefined && given === undefined && tags === undefined && date === undefined && draft === undefined)
        throw new InvalidBodyError("nothing to change: send markdown, title, sender, tags, date, draft or several");
      checkNoteMeta({ title, sender: given, tags, date }); // before the content is replaced: a bad value must not leave a half edit
      let note =
        markdown === undefined
          ? undefined
          : await editContent(feed, id, clientIp(h), async () => ({ body: new TextEncoder().encode(markdown), mediaType: "text/markdown" }), {
              password,
              account,
            });
      if (title !== undefined || given !== undefined || tags !== undefined || date !== undefined || draft !== undefined)
        note = await editMeta(feed, id, clientIp(h), async () => ({ title, sender: given, tags, date, draft }), { password, account });
      const edited = summary(feed, note!);
      return ok({ ...edited, ...(note!.content !== undefined && { content: note!.content }), guidance: next.afterEdit({ ...state(note!), url: edited.url }) });
    }),
  );

  s.registerTool(
    "delete_note",
    {
      description: `Permanently delete a note. ${PROTECTED} ${SECRET_NOTE}`,
      inputSchema: z.object({ feed, id: z.string(), password }),
      outputSchema: Deleted,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    guard(async ({ feed, id, password }) => {
      await deleteNote(feed, id, clientIp(h), { password, account });
      return ok({ deleted: true as const, guidance: next.afterDeleteNote() });
    }),
  );

  // The API's Feed with its fields inlined: an id in .meta() turns into a top-level $ref, and an
  // MCP output schema must be an object at its root. Built from FeedJson so a new field is declared here too (#245).
  const FeedOut = z.object({
    ...FeedJson.shape,
    free_tier: z
      .object(FreeTierJson.shape)
      .nullable()
      .describe(FeedJson.shape.free_tier.description ?? ""),
    guidance: GUIDANCE,
  });

  s.registerTool(
    "get_feed",
    {
      description: `Get a feed's title, description, title image, whether it is protected, its read link (null while it has no notes), whether readers see who posted, and, on a free feed where licenses are sold, its notes against the free cap. ${PROTECTED} ${SECRET_NOTE}`,
      inputSchema: z.object({ feed, password }),
      outputSchema: FeedOut,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guard(async ({ feed, password }) => {
      await checkAccess(feed, password);
      if (!(await hasFeed(feed))) throw new NotFoundError("no such feed");
      const f = await feedJson(feed, h);
      return ok({ ...f, guidance: next.afterFeed(feedGuidance(f)) });
    }),
  );

  s.registerTool(
    "get_licenses",
    {
      description:
        "Only on an instance that sells licenses. What a license costs (plans, amounts in cents, per feed), the license page (buy_url) and where an account manages its license (manage_url, the account page). A license belongs to an account: buy_license buys one for this client's account, get_license shows it, update_feed's licensed puts one of its feeds under it.",
      inputSchema: z.object({}),
      outputSchema: z.object({ ...LicensesJson.shape, guidance: GUIDANCE }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard(async () => {
      const l = await licensesJson(h);
      return ok({ ...l, guidance: next.afterLicenses(l) });
    }),
  );

  s.registerTool(
    "update_feed",
    {
      description: `Change a feed's settings; whatever is left out stays as it is, and at least one is needed. title (at most 100 characters) and description (at most 500) are one line each (control and text-direction override characters are refused); an empty title shows the feed's name. image is the file name upload_image returned for this feed (the title image), empty to remove it. read_id gives the feed another read link (3 to 64 characters of a-z, 0-9, - and _; empty for a random one): the old link stops showing this feed and may later show another one, relative image links in notes follow, full URLs do not. name renames the feed, last: everything goes with it, the answer is the feed under its new name, and the old name stops working at once (a later post to it creates a new feed); a reserved feed keeps its name. licensed, only on an instance that sells licenses and for the feed's owner: puts the feed under the account's license (true) or takes it off (false); it is applied first. new_password sets the feed's password: on a protected feed it changes it (password is the current one); an open feed takes it without one, which claims the feed (its name was all that protected it). From then on every call for the feed needs the new password; the read link stays open. The feed must exist. ${PROTECTED} ${SECRET_NOTE}`,
      inputSchema: z.object({
        feed,
        title: z.string().optional(),
        description: z.string().optional(),
        image: z.string().optional(),
        read_id: z.string().optional(),
        name: z
          .string()
          .optional()
          .describe(
            "A new name for the feed (1 to 64 characters of a-z, 0-9, - and _). Everything goes with it; the old name stops working at once, so use the new one in every later call and tell the user to change it wherever it is configured (NOTEFEED_FEED, CI secrets, scripts, MCP configurations) before those next run: a post to the old name creates a new, empty feed without an error.",
          ),
        sender_name: z
          .string()
          .optional()
          .describe(
            "What the owner's own notes show as their sender (posted by the owner's account without a sender of their own); changing it changes it on all of them. One line, at most 100 characters; empty shows none. Only for the feed's owner",
          ),
        licensed: z
          .boolean()
          .optional()
          .describe(
            "Only on an instance that sells licenses, for the feed's owner: true puts it under the account's license (needs a unit free), false takes it off.",
          ),
        new_password: z.string().optional().describe("The feed's new password: 1 to 256 printable ASCII characters, with no space at the start or end."),
        password,
      }),
      outputSchema: FeedOut,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    guard(async ({ feed, title, description, image, read_id, name, sender_name, licensed, new_password, password }) => {
      const settings =
        title !== undefined || description !== undefined || image !== undefined || read_id !== undefined || name !== undefined || sender_name !== undefined;
      if (!settings && licensed === undefined && new_password === undefined)
        throw new InvalidBodyError("nothing to change: send title, description, image, read_id, name, sender_name, licensed, new_password or several");
      const ip = clientIp(h);
      const readIdBefore = read_id === undefined ? undefined : (await feedJson(feed, h).catch(() => undefined))?.read_url;
      // First, so a key that is refused changes nothing else (#247); the license may be what the new password needs.
      if (licensed !== undefined) await setFeedCovered(feed, ip, licensed, { password, account });
      if (new_password !== undefined) {
        assertFeed(feed); // a reserved name must not reach the lookup
        await changePassword(feed, password ?? "", new_password, ip);
      }
      // From here on the feed's password is the new one.
      const access = { password: new_password ?? password, account };
      let now = feed;
      if (settings) {
        now = (
          await updateFeed(
            feed,
            ip,
            async () => {
              const stored = await getStoredSettings(feed); // after the password check: what is left out stays
              return { title: title ?? stored.title, description: description ?? stored.description, image, readId: read_id, name, senderName: sender_name };
            },
            access,
          )
        ).feed;
      }
      const f = await feedJson(now, h);
      const guidance = next.afterUpdate({
        ...feedGuidance(f),
        name: now !== feed ? now : undefined,
        readIdChanged: read_id !== undefined && f.read_url !== readIdBefore,
        newPassword: new_password !== undefined,
        license: licensed === undefined ? undefined : licensed ? "on" : "off",
      });
      return ok({ ...f, guidance });
    }),
  );

  s.registerTool(
    "create_feed",
    {
      description: `Create a feed without posting a note, to reserve its name (feeds are otherwise created by their first note). password protects it from its first moment; read_id gives it that read link. Where licenses are sold, it needs this client's account with a unit of its license free, and goes under it. A feed that exists is refused. Set its title and description afterwards with update_feed. ${SECRET_NOTE}`,
      inputSchema: z.object({
        feed,
        password: z
          .string()
          .optional()
          .describe("A password for the new feed: 1 to 256 printable ASCII characters, with no space at the start or end. Left out: an open feed."),
        read_id: z.string().optional().describe("The read id to give the feed (3 to 64 characters of a-z, 0-9, - and _); left out: a random one."),
      }),
      outputSchema: FeedOut,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    guard(async ({ feed, password, read_id }) => {
      await createFeed(feed, clientIp(h), { password, readId: read_id }, account);
      const f = await feedJson(feed, h);
      return ok({ ...f, guidance: next.afterCreate(feedGuidance(f)) });
    }),
  );

  s.registerTool(
    "get_license",
    {
      description:
        "Only on an instance that sells licenses: the license of the account this client signed in as. Its subscriptions (units, period, end), how many feeds they cover together, the feeds put under it and those it covers now.",
      inputSchema: z.object({}),
      outputSchema: z.object({ ...AccountLicenseJson.shape, guidance: GUIDANCE }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guard(async () => {
      requireLicensesSold();
      const l = await licenseOf(needAccount());
      return ok({ ...l, guidance: next.afterLicense(l) });
    }),
  );

  s.registerTool(
    "buy_license",
    {
      description:
        "Only on an instance that sells licenses: a checkout at the payment provider for units feeds (1 to 100) per period (month, or year where sold), for this client's account. Returns the URL for the person to open and pay at; a new subscription is on the account once paid.",
      inputSchema: z.object({
        period: z.enum(["month", "year"]).optional().describe("Default month"),
        units: z.number().int().optional().describe("How many feeds, 1 to 100; default 1"),
      }),
      outputSchema: z.object({ url: z.string(), guidance: GUIDANCE }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    guard(async ({ period, units }) => {
      const { url } = await startCheckout(needAccount(), period ?? "month", units ?? 1);
      return ok({ url, guidance: next.afterCheckout() });
    }),
  );

  s.registerTool(
    "change_license_units",
    {
      description:
        "Change how many feeds one of the account's subscriptions covers (its id from get_license): raising charges the difference now; lowering takes effect without a refund and goes no lower than the feeds under the license allow (take one off with update_feed's licensed false first).",
      inputSchema: z.object({ id: z.string().describe("The subscription's id"), units: z.number().int().describe("The new number, 1 to 100") }),
      outputSchema: z.object({ changed: z.literal(true), guidance: GUIDANCE }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard(async ({ id, units }) => {
      await changeUnits(needAccount(), id, units);
      return ok({ changed: true as const, guidance: next.afterUnits() });
    }),
  );

  s.registerTool(
    "set_feed_image",
    {
      description: `Set the feed's title image, shown in its header: the image as base64 in data, its media type in type (image/png, image/jpeg, image/gif or image/webp). It is the feed's own image, in no list (timeline, RSS, counts), so it is no post; a previous one set this way is deleted. To remove the title image, use update_feed with image "". To use a picture already posted, use update_feed's image instead. ${PICTURES} ${PROTECTED} ${SECRET_NOTE}`,
      inputSchema: z.object({ feed, type: z.string().describe("The image's media type"), data: z.string().describe("The image's bytes, base64"), password }),
      outputSchema: FeedOut,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    guard(async ({ feed, type, data, password }) => {
      const parsed = parseMediaType(type);
      if (parsed?.type.name !== "image") throw new UnsupportedTypeError("a title image must be an image");
      const body = Buffer.from(data, "base64");
      if (body.length > config.maxImageBytes()) throw new ImageTooLargeError();
      if (!body.length) throw new UnsupportedTypeError("data is empty");
      await setFeedImage(feed, clientIp(h), async () => ({ body, mediaType: parsed.mediaType }), { password, account });
      return ok({ ...(await feedJson(feed, h)), guidance: next.afterSetImage() });
    }),
  );

  s.registerTool(
    "delete_feed",
    {
      description: `Permanently delete a feed with all its notes, settings, password and read link. There is no undo. ${PROTECTED} ${SECRET_NOTE}`,
      inputSchema: z.object({ feed, password }),
      outputSchema: Deleted,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    guard(async ({ feed, password }) => {
      await deleteFeed(feed, clientIp(h), { password, account });
      return ok({ deleted: true as const, guidance: next.afterDeleteFeed() });
    }),
  );

  s.registerTool(
    "post_file",
    {
      description: `Post a file as a note, as base64 in data, with its media type in type: ${ACCEPTED_TYPES}. Nothing is guessed: the data must be what type says (an image has its format's signature, markdown is UTF-8). The feed is created by its first note. Returns the note's id, its file name and its public URL (public like the feed's read link). ${PICTURES} ${PROTECTED} ${SECRET_NOTE}`,
      inputSchema: z.object({
        feed,
        type: z.string().describe("The file's media type"),
        data: z.string().describe("The file's bytes, base64"),
        ...noteFieldSchemas(["title", "sender", "alt", "name", "tags", "date", "draft"], "post"),
        password,
      }),
      outputSchema: z.object({ id: z.string(), file: z.string(), url: z.string(), draft: DRAFT_OUT, guidance: GUIDANCE }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    guard(async ({ feed, type, data, password, ...meta }) => {
      const { note, readId } = await postBytes(feed, { type, data, ...meta }, password);
      const url = fileUrl(readId, note.file);
      return ok({ id: note.id, file: note.file, url, ...(note.draft && { draft: true as const }), guidance: next.afterPostFile({ ...state(note), url }) });
    }),
  );

  s.registerTool(
    "list_feeds",
    {
      description:
        "The feeds of the account this client signed in as (its own: it created or claimed them). Needs a client signed in with an account (accounts on).",
      inputSchema: z.object({}),
      outputSchema: z.object({ feeds: z.array(z.string()), guidance: GUIDANCE }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guard(async () => {
      const feeds = await ownedFeeds(needAccount());
      return ok({ feeds, guidance: next.afterListFeeds(feeds.length) });
    }),
  );

  s.registerTool(
    "claim_feed",
    {
      description:
        "Make a feed the account's own: then only the account manages its feed passwords, renames and deletes it. A protected feed: give one of its passwords, which keeps working as its first, named 'Feed password'. An open feed: give the password it gets now. A feed with an owner can't be claimed.",
      inputSchema: z.object({ feed, password: z.string().describe("A protected feed's password, or an open feed's new one") }),
      outputSchema: z.object({ claimed: z.literal(true), guidance: GUIDANCE }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    guard(async ({ feed: name, password: given }) => {
      assertFeed(name);
      await claimFeed(name, needAccount(), given, clientIp(h));
      return ok({ claimed: true as const, guidance: next.afterClaim() });
    }),
  );

  s.registerTool(
    "list_feed_passwords",
    {
      description: "An owned feed's passwords: their names, ids and when they were added, never the passwords. Only for the feed's owner.",
      inputSchema: z.object({ feed }),
      outputSchema: z.object({ passwords: z.array(z.object({ id: z.string(), name: z.string(), created: z.string().nullable() })), guidance: GUIDANCE }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guard(async ({ feed: name }) => {
      assertFeed(name);
      const passwords = await listFeedPasswords(name, needAccount());
      return ok({ passwords, guidance: next.afterListFeedPasswords(passwords.length) });
    }),
  );

  s.registerTool(
    "add_feed_password",
    {
      description:
        'Add a named password to an owned feed, for one person or script ("blog script", "Anna"); it is generated and returned only this once, and revoked on its own. Only for the feed\'s owner; where licenses are sold, the feed needs one.',
      inputSchema: z.object({ feed, name: z.string().describe("What it is for: one line, 1 to 50 characters") }),
      outputSchema: z.object({ id: z.string(), name: z.string(), password: z.string(), guidance: GUIDANCE }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    guard(async ({ feed: name, name: label }) => {
      assertFeed(name);
      const added = await addFeedPassword(name, needAccount(), label);
      return ok({ id: added.id, name: added.name, password: added.password, guidance: next.afterAddSecret("feed password") });
    }),
  );

  s.registerTool(
    "revoke_feed_password",
    {
      description:
        "Revoke one of an owned feed's passwords by its id: it, and every browser unlocked with it, stops working at once. Only for the feed's owner.",
      inputSchema: z.object({ feed, id: z.string().describe("The password's id, from list_feed_passwords") }),
      outputSchema: z.object({ revoked: z.literal(true), guidance: GUIDANCE }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    guard(async ({ feed: name, id }) => {
      assertFeed(name);
      await revokeFeedPassword(name, needAccount(), id);
      return ok({ revoked: true as const, guidance: next.afterRevoke("feed password") });
    }),
  );

  s.registerTool(
    "create_account_token",
    {
      description:
        "Make an account token: for a script that acts as the whole account over the REST API (Authorization: Bearer <token>), never over MCP. scope read only reads; read+write (default) does everything the account may. Returned only this once.",
      inputSchema: z.object({
        name: z.string().describe("What it is for: one line, 1 to 50 characters"),
        scope: z.enum(["read", "read+write"]).optional().describe("Default read+write"),
        days: z.number().int().optional().describe("How long it works, 1 to 365; default 90"),
      }),
      outputSchema: z.object({ id: z.string(), token: z.string(), expires_at: z.string().nullable(), guidance: GUIDANCE }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    guard(async ({ name, scope, days }) => {
      const t = await createAccountToken(needAccount(), name, scope ?? "read+write", days);
      return ok({ id: t.id, token: t.token, expires_at: t.expiresAt, guidance: next.afterAddSecret("account token") });
    }),
  );

  s.registerTool(
    "list_account_tokens",
    {
      description: "The account's tokens: names, scopes, ends and last use, never the tokens.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        tokens: z.array(z.object({ id: z.string(), name: z.string(), scope: z.string(), expires_at: z.string().nullable(), last_used: z.string().nullable() })),
        guidance: GUIDANCE,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guard(async () => {
      const tokens = (await listAccountTokens(needAccount())).map((t) => ({
        id: t.id,
        name: t.name,
        scope: t.scope,
        expires_at: t.expiresAt,
        last_used: t.lastUsed,
      }));
      return ok({ tokens, guidance: next.afterListTokens(tokens.length) });
    }),
  );

  s.registerTool(
    "revoke_account_token",
    {
      description: "Revoke one of the account's tokens by its id; it stops working at once.",
      inputSchema: z.object({ id: z.string().describe("The token's id, from list_account_tokens") }),
      outputSchema: z.object({ revoked: z.literal(true), guidance: GUIDANCE }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    guard(async ({ id }) => {
      await revokeAccountToken(needAccount(), id);
      return ok({ revoked: true as const, guidance: next.afterRevoke("account token") });
    }),
  );
  return s;
}

// The SDK's default of 4 MiB would refuse a valid 3 MB picture (base64 is a third larger). Pictures are sent full size and shrunk here
// (ADR 0049), so a call takes what Next's proxy passes on: several full-size photos in base64.
// "auto" answers with one JSON body unless a tool emits mid-call notifications, which ours never do.
const handler = createMcpHandler(({ requestInfo, authInfo }) => server(requestInfo!.headers, authInfo?.extra?.account as string | undefined), {
  legacy: "reject",
  maxRequestBodySize: MAX_REQUEST_BYTES,
});

const rpcError = (status: number, message: string, headers?: Record<string, string>) =>
  Response.json({ jsonrpc: "2.0", error: { code: -32600, message } }, { status, headers });

// What may reach the handler. The SDK doesn't check Origin, so a browser page of another site can't drive
// this endpoint: no Origin (server-side clients) passes, a present one must be our own host. That stops
// DNS rebinding only when PUBLIC_URL is set; without it our host comes from the request's own Host header.
// With accounts, a client sends Better Auth's access token (tokenGate). An instance the password locks takes the password as the
// bearer, or, with PUBLIC_URL, a Better Auth token its OAuth login gave for the password (ADR 0062).
async function gate(req: Request): Promise<Response | AuthInfo | undefined> {
  const origin = req.headers.get("origin");
  if (origin !== null) {
    let host: string | null = null;
    try {
      host = new URL(origin).host;
    } catch {}
    if (host !== new URL(publicUrl(req.headers)).host) return rpcError(403, "forbidden origin");
  }
  const auth = oauthAuth();
  if (auth && accountsOn()) return tokenGate(req, auth);
  if (!locked()) return undefined; // an open instance without accounts: anyone may call
  // A JWT is never a password guess: it goes to Better Auth's check, and no failed attempt is counted. The password itself may look
  // like one (two dots), so it is compared first.
  const bearer = bearerOf(req.headers.get("authorization"));
  if (auth && bearer.split(".").length === 3 && !safeEqual(bearer, config.password())) return tokenGate(req, auth);
  try {
    checkBearer(req.headers.get("authorization"), clientIp(req.headers));
  } catch (e) {
    if (e instanceof TooManyAttemptsError) return rpcError(429, e.message, { "retry-after": String(e.retryAfter) });
    if (e instanceof AuthError) return rpcError(401, e.message, { "www-authenticate": auth ? `Bearer ${resourceMetadata(req)}` : 'Bearer realm="notefeed"' });
    throw e;
  }
  return { token: "", clientId: "password", scopes: [] };
}

const resourceMetadata = (req: Request) => `resource_metadata="${publicUrl(req.headers)}/.well-known/oauth-protected-resource/mcp"`;

// Better Auth's MCP check (signature, issuer, audience /mcp, expiry) answers a missing or bad token with its 401 and the protected
// resource's metadata (ADR 0062). With accounts, a token must name an account that may still be signed in (a client-only token names
// none), checked on every request as a browser session is (ADR 0056), and an open instance lets a client without a token in, as
// no one. Without accounts, it must name the user that stands for the instance under its current password.
async function tokenGate(req: Request, auth: Auth): Promise<Response | AuthInfo | undefined> {
  if (!req.headers.has("authorization") && !locked()) return undefined;
  let claims: JWTPayload | undefined;
  const checked = await requireMcpAuth(
    auth,
    (_req, c) => {
      claims = c;
      return new Response(null, { status: 204 });
    },
    { resource: mcpResource(req.headers) },
  )(req);
  if (!claims) return checked;
  const sub = typeof claims.sub === "string" ? claims.sub : undefined;
  const ok = !!sub && (accountsOn() ? await stillAllowed(sub) : sub === (await instanceUser(auth)));
  if (!ok) return rpcError(401, "invalid token", { "www-authenticate": `Bearer error="invalid_token", ${resourceMetadata(req)}` });
  const scope = typeof claims.scope === "string" ? claims.scope.split(" ") : [];
  const token = bearerOf(req.headers.get("authorization"));
  return { token, clientId: String(claims.azp ?? "oauth"), scopes: scope, ...(accountsOn() ? { extra: { account: sub } } : {}) };
}

export async function mcpRoute(req: Request): Promise<Response> {
  const auth = await gate(req);
  if (auth instanceof Response) return auth;
  return handler.fetch(req, { authInfo: auth });
}
