// The operator's endpoints. Off (404) unless NOTEFEED_OPERATOR_TOKEN is set (32 bytes or more); then each needs
// `Authorization: Bearer <token>`. They are under /api, which proxy.ts leaves to its handlers, and not in the public API description:
// they are the operator's, as /metrics is.
//   /api/operator/images/unreferenced (issue #127)
//     GET     what is in the store that no note names (count and bytes), without touching it
//     DELETE  the same, and those objects are removed
//   /api/operator/takedown (issue #155, #159)
//     POST    removes the feed a read link, a read id or an image URL names, for good, and blocklists its images; with
//             "scope": "note", only the post a note's read URL or an image URL names, and leaves a mark in its place
//   /api/operator/images/move (issue #128)
//     POST    moves image bytes into the configured store, from the rows or from another store named in the JSON body
//   /api/operator/reseal (issue #212)
//     POST    encrypts the notes stored before NOTEFEED_ENCRYPTION_KEY was set, a batch per call
//   /api/operator/accounts (#388, ADR 0057; 404 while accounts are off)
//     POST    a new account, with accounts `open` or `closed` (the only way in `closed`): its number and recovery key, once
//     DELETE  ?number=<account number>: that account, with its feeds, sessions and passkeys
//   /api/operator/feeds?feed=<name> (#389, ADR 0059)
//     PUT     {"number": "<account number>" | null}: gives the feed to that account, or takes its owner away; for a feed whose
//             owner's account is gone, or reserved feeds. Its passwords stay
//     DELETE  the feed with everything in it, owned or not
//   /api/operator/subscriptions (#391, ADR 0061)
//     POST    {"number": "<account number>", "subscription": "<the provider's subscription id>"}: puts a subscription the provider
//             already has on that account, read from the provider (units, end): how a license bought before accounts moves to one
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { config } from "../config";
import { authFailed, authWait, clientIp } from "../limits";
import { logger } from "../log";
import { imagesSwept } from "../metrics";
import { storage } from "../storage";
import { NotefeedError } from "../errors";
import { statusOf } from "./errors";
import { createFsImageStore } from "../storage/images/fs";
import { createS3ImageStore } from "../storage/images/s3";
import type { ImageStore } from "../storage/images/types";
import type { SqlStorage } from "../storage/sql";
import { takedown, takedownNote } from "../takedown";
import { accountsMode, accountsOn } from "../accounts/mode";
import { accountIdOf, createAccount, formatNumber } from "../accounts/numbers";
import { deleteAccountWithFeeds, removeFeedAndLicense } from "../posting";
import { setFeedOwner } from "../feedlock";
import { assertFeed } from "../feeds";

// An object younger than this is never counted or removed: its note's row may still be on its way (the object is written first).
export const MIN_AGE_MS = 3_600_000;

const log = logger("operator");
// Both sides hashed first, so the comparison takes the same time and works for tokens of any length.
const digest = (s: string) => createHash("sha256").update(s).digest();
const sameToken = (given: string, expected: string) => timingSafeEqual(digest(given), digest(expected));
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

// The gate of every operator endpoint: 404 while there is no token, 429 after too many wrong ones, 401 for a wrong or missing one.
function gate(req: Request): Response | null {
  const token = config.operatorToken();
  if (!token) return json({ error: "not found" }, 404);
  const ip = clientIp(req.headers);
  const wait = authWait(ip);
  if (wait !== null) return json({ error: "too many failed attempts" }, 429, { "Retry-After": String(wait) });
  const given = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? "";
  if (!given || !sameToken(given, token)) {
    authFailed(ip);
    return json({ error: "unauthorized" }, 401, { "WWW-Authenticate": "Bearer" });
  }
  return null;
}

export async function unreferencedImagesRoute(req: Request): Promise<Response> {
  const refused = gate(req);
  if (refused) return refused;
  const remove = req.method === "DELETE";
  const s = storage() as Partial<SqlStorage>;
  let sweep;
  try {
    sweep = (await s.sweepImages?.({ remove, olderThanMs: MIN_AGE_MS })) ?? null;
  } catch (err) {
    log.error({ err }, "the image store could not be checked for unreferenced images");
    return json({ error: "the image store could not be read; see the log" }, 502);
  }
  if (!sweep) return json({ error: "this instance has no image store: NOTEFEED_IMAGES is db, or NOTEFEED_STORAGE is fs" }, 409);
  const left = { count: sweep.unreferenced.count - sweep.deleted.count, bytes: sweep.unreferenced.bytes - sweep.deleted.bytes };
  imagesSwept({ ...left, missing: sweep.missing });
  return json({
    store: config.images(),
    unreferenced: sweep.unreferenced,
    ...(remove && { deleted: sweep.deleted, failed: sweep.failed }),
    too_recent: sweep.tooRecent,
    missing: sweep.missing,
  });
}

// The body names the feed: `{"target": "<read link | read id | image URL>"}`; with `"scope": "note"` the target names one post
// (`<note read URL | image URL | read id>/<note>`), which goes with its attachments and leaves the mark (#159). The answer says what went and never the feed's name;
// `image_keys` are the image store objects removed, for the operator's purge of backups.
export async function takedownRoute(req: Request): Promise<Response> {
  const refused = gate(req);
  if (refused) return refused;
  const body = (await req.json().catch(() => undefined)) as { target?: unknown; scope?: unknown } | undefined;
  if (typeof body?.target !== "string" || !body.target.trim())
    return json({ error: 'the body is JSON with "target": a read link, a read id or an image URL' }, 400);
  if (body.scope !== undefined && body.scope !== "feed" && body.scope !== "note") return json({ error: '"scope" is "feed" (the default) or "note"' }, 400);
  try {
    return json(body.scope === "note" ? await takedownNote(body.target) : await takedown(body.target));
  } catch (e) {
    if (e instanceof NotefeedError) return json({ error: e.message, code: e.code }, statusOf(e));
    log.error({ err: e }, "the takedown failed");
    return json({ error: "the takedown failed; see the log" }, 500);
  }
}

// What the move takes from: the rows (`db`), a folder, or an S3-compatible store with its settings. The source's secrets travel in the
// body of this one request and are never logged or answered back.
const MoveBody = z
  .discriminatedUnion("from", [
    z.object({ from: z.literal("db") }),
    z.object({ from: z.literal("fs"), dir: z.string().min(1) }),
    z.object({
      from: z.literal("s3"),
      endpoint: z.string().url(),
      bucket: z.string().min(1),
      region: z.string().min(1).default("us-east-1"),
      access_key: z.string().min(1),
      secret_key: z.string().min(1),
    }),
  ])
  .and(z.object({ limit: z.number().int().min(1).max(10_000).default(100), after: z.string().min(1).optional() }));

export async function moveImagesRoute(req: Request): Promise<Response> {
  const refused = gate(req);
  if (refused) return refused;
  const parsed = MoveBody.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success)
    return json(
      {
        error:
          'the body is JSON with "from": "db", "fs" (with "dir") or "s3" (with "endpoint", "bucket", "access_key", "secret_key", optional "region"), and an optional "limit"',
      },
      400,
    );
  const body = parsed.data;
  const from: ImageStore | "db" =
    body.from === "db"
      ? "db"
      : body.from === "fs"
        ? createFsImageStore(body.dir)
        : createS3ImageStore({ endpoint: body.endpoint, bucket: body.bucket, region: body.region, accessKey: body.access_key, secretKey: body.secret_key });
  const s = storage() as Partial<SqlStorage>;
  if (!s.moveImages) return json({ error: "this instance has no database: NOTEFEED_STORAGE is fs, and an image is the note's own file" }, 409);
  let move;
  try {
    move = await s.moveImages({ from, limit: body.limit, after: body.after });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/nothing to move/.test(message)) return json({ error: message }, 409);
    log.error({ err }, "images could not be moved");
    return json({ error: "the images could not be moved; see the log" }, 502);
  }
  return json({
    store: config.images(),
    from: body.from,
    moved: move.moved,
    skipped: move.skipped,
    missing: move.missing,
    failed: move.failed,
    left: move.left,
    next: move.next,
  });
}

// POST /api/operator/reseal (issue #212): encrypts, bit by bit, the notes stored before NOTEFEED_ENCRYPTION_KEY was set.
const ResealBody = z.object({ limit: z.number().int().min(1).max(10_000).default(100), after: z.string().min(1).optional() });

export async function resealRoute(req: Request): Promise<Response> {
  const refused = gate(req);
  if (refused) return refused;
  const text = await req.text().catch(() => "");
  // No body: the defaults. A body that is not JSON stays a 400.
  const parsed = ResealBody.safeParse(
    text.trim() === ""
      ? {}
      : await Promise.resolve()
          .then(() => JSON.parse(text))
          .catch(() => undefined),
  );
  if (!parsed.success)
    return json({ error: 'the body is JSON with an optional "limit" (1 to 10000) and an optional "after" (the previous answer\'s "next")' }, 400);
  const s = storage() as Partial<SqlStorage>;
  if (!s.reseal) return json({ error: "this instance has no database: NOTEFEED_STORAGE is fs, which is not encrypted" }, 409);
  let r;
  try {
    r = await s.reseal(parsed.data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/nothing to reseal/.test(message)) return json({ error: message }, 409);
    log.error({ err }, "notes could not be resealed");
    return json({ error: "the notes could not be resealed; see the log" }, 502);
  }
  return json({ resealed: r.resealed, skipped: r.skipped, failed: r.failed, left: r.left, next: r.next });
}

// POST /api/operator/accounts: a new account, its number and recovery key once.
export async function operatorAccountCreateRoute(req: Request): Promise<Response> {
  const refused = gate(req);
  if (refused) return refused;
  if (!accountsOn()) return json({ error: "accounts are off" }, 404);
  // In `provider` mode every account comes through the identity provider and its allow-list.
  if (accountsMode() === "provider") return json({ error: "accounts come from the identity provider (NOTEFEED_ACCOUNTS=provider)" }, 409);
  const { number, recoveryKey } = await createAccount();
  log.info("account created by the operator"); // never which
  return json({ number: formatNumber(number), recoveryKey }, 201);
}

// DELETE /api/operator/accounts?number=: that account, with its feeds.
export async function operatorAccountDeleteRoute(req: Request): Promise<Response> {
  const refused = gate(req);
  if (refused) return refused;
  if (!accountsOn()) return json({ error: "accounts are off" }, 404);
  const account = await accountIdOf(new URL(req.url).searchParams.get("number") ?? "");
  if (!account) return json({ error: "no such account" }, 404);
  await deleteAccountWithFeeds(account); // its feeds first
  log.info("account deleted by the operator");
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

// The feed ?feed= names, or the 400 for a name that isn't one; after the operator's token.
function operatorFeed(req: Request): string | Response {
  const refused = gate(req);
  if (refused) return refused;
  const feed = new URL(req.url).searchParams.get("feed") ?? "";
  try {
    assertFeed(feed);
  } catch {
    return json({ error: "invalid feed name" }, 400);
  }
  return feed;
}

// PUT /api/operator/feeds?feed=: gives the feed to an account, or takes its owner away.
export async function operatorFeedOwnerRoute(req: Request): Promise<Response> {
  const feed = operatorFeed(req);
  if (feed instanceof Response) return feed;
  const body = (await req.json().catch(() => null)) as { number?: unknown } | null;
  if (!body || (body.number !== null && typeof body.number !== "string")) return json({ error: 'JSON needs "number": an account number or null' }, 400);
  let owner: string | undefined;
  if (typeof body.number === "string") {
    if (!accountsOn()) return json({ error: "accounts are off" }, 404);
    owner = await accountIdOf(body.number);
    if (!owner) return json({ error: "no such account" }, 404);
  }
  try {
    await setFeedOwner(feed, owner);
  } catch (e) {
    if (e instanceof NotefeedError && e.code === "not_found") return json({ error: "no such feed" }, 404);
    throw e;
  }
  log.info({ owner: owner ? "given" : "taken away" }, "feed owner set by the operator");
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

// DELETE /api/operator/feeds?feed=: the feed with everything in it, owned or not.
export async function operatorFeedDeleteRoute(req: Request): Promise<Response> {
  const feed = operatorFeed(req);
  if (feed instanceof Response) return feed;
  if (!(await removeFeedAndLicense(feed))) return json({ error: "no such feed" }, 404);
  log.info("feed deleted by the operator"); // never its name
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

// POST /api/operator/subscriptions: puts a subscription the provider already has on an account.
export async function operatorSubscriptionsRoute(req: Request): Promise<Response> {
  const refused = gate(req);
  if (refused) return refused;
  const body = (await req.json().catch(() => null)) as { number?: unknown; subscription?: unknown } | null;
  if (typeof body?.number !== "string" || typeof body.subscription !== "string" || !body.subscription)
    return json({ error: 'JSON needs "number" (an account number) and "subscription" (the provider\'s id)' }, 400);
  const account = await accountIdOf(body.number);
  if (!account) return json({ error: "no such account" }, 404);
  const { attachSubscription } = await import("../licenseflow");
  try {
    await attachSubscription(account, body.subscription);
  } catch (e) {
    if (e instanceof NotefeedError) return json({ error: e.message, code: e.code }, statusOf(e));
    throw e;
  }
  log.info("subscription put on an account by the operator"); // never which
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
