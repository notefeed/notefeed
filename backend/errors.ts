// Everything the backend refuses, as classes. `message` is the API's wording (lower case, no period),
// `code` the stable key the web UI words itself (shared/errors.ts). Each adapter maps the class to
// its own form; nothing parses a message.
import { UNAVAILABLE_DIGEST, type ErrorCode } from "../shared/errors";
import { ACCEPTED_TYPES } from "./note/media";

export class NotefeedError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidFeedError extends NotefeedError {
  constructor() {
    super("invalid_feed", "invalid feed name");
  }
}
export class ReservedFeedError extends NotefeedError {
  constructor() {
    super("reserved_feed", "feed name is reserved");
  }
}

export class AuthError extends NotefeedError {
  constructor() {
    super("auth", "missing or wrong password");
  }
}

/** Over a per-IP limit; `retryAfter` is the wait in whole seconds (≥ 1). */
export class RateLimitedError extends NotefeedError {
  constructor(
    readonly retryAfter: number,
    code: ErrorCode = "rate_limited",
    message = "rate limit exceeded",
  ) {
    super(code, message);
  }
}
/** Too many failed passwords: not even compared until the window ends. */
export class TooManyAttemptsError extends RateLimitedError {
  constructor(retryAfter: number) {
    super(retryAfter, "too_many_attempts", "too many attempts");
  }
}

/** NOTEFEED_MAX_FEEDS or NOTEFEED_MAX_NOTES_PER_FEED reached. */
export class LimitReachedError extends NotefeedError {}
export class FeedLimitError extends LimitReachedError {
  constructor() {
    super("feed_limit", "feed limit reached");
  }
}
export class NoteLimitError extends LimitReachedError {
  constructor() {
    super("note_limit", "note limit reached");
  }
}

export class ImageLimitError extends LimitReachedError {
  constructor() {
    super("image_limit", "image limit reached");
  }
}

/** The feed, by its name or its read id, was removed by the operator and neither can be used again (issue #155). */
export class RemovedFeedError extends NotefeedError {
  constructor() {
    super("removed", "this feed was removed by the operator");
  }
}
/** The image's bytes are on the instance's blocklist: they were removed by the operator and may not come back. */
export class BlockedImageError extends NotefeedError {
  constructor() {
    super("blocked", "this image may not be posted here");
  }
}
/** NOTEFEED_IMAGE_UPLOADS=0: no image is stored, whichever way it comes (issue #152). */
export class ImagesOffError extends NotefeedError {
  constructor() {
    super("images_off", "image uploads are off on this instance");
  }
}

/** On an instance with a payment provider: the feed has no active license, and this (images, a feed password) is for licensed feeds (ADR 0029). */
export class LicenseRequiredError extends NotefeedError {
  constructor() {
    super("license_required", "a license is needed for this feed");
  }
}

/** A feed password was asked for (set, change, remove) on a feed that exists and has none. */
export class FeedExistsError extends NotefeedError {
  constructor(message = "feed already exists and has no password") {
    super("feed_exists", message);
  }
}

/** A note was to become a draft while it, or a picture posted with it, is the feed's title image, which readers see (#265). */
export class TitleImageDraftError extends NotefeedError {
  constructor() {
    super("title_image", "the feed's title image is a picture of this note: choose another title image first");
  }
}

/** A chosen read id belongs to another feed or is held back for a reserved one. */
export class ReadIdTakenError extends NotefeedError {
  constructor() {
    super("taken", "that read id is not available");
  }
}

export class EmptyNoteError extends NotefeedError {
  constructor() {
    super("empty_note", "note is empty");
  }
}
export class NoteTooLargeError extends NotefeedError {
  constructor() {
    super("too_large", "note exceeds 100 KB");
  }
}
/** The request body can't be read as a note: the content type, or (InvalidBodyError) not UTF-8 or bad JSON. */
export class UnsupportedTypeError extends NotefeedError {
  constructor(message = `send a Content-Type of ${ACCEPTED_TYPES} (markdown as UTF-8)`) {
    super("unsupported_type", message);
  }
}
export class ImageTooLargeError extends NotefeedError {
  constructor(message = "image exceeds the size limit") {
    super("too_large", message);
  }
}
export class InvalidBodyError extends NotefeedError {
  constructor(message: string) {
    super("invalid_body", message);
  }
}
/** A license key notefeed doesn't know: a bad body like any other, and a failed attempt, as a wrong password is (#247). */
export class UnknownLicenseKeyError extends InvalidBodyError {
  constructor() {
    super("that is not a license key");
  }
}

/** A path or query parameter the API can't use, e.g. `limit=0`. */
export class InvalidRequestError extends NotefeedError {
  constructor(message: string) {
    super("invalid_request", message);
  }
}
export class NotFoundError extends NotefeedError {
  constructor(message = "not found") {
    super("not_found", message);
  }
}

// A note the operator removed (issue #159): its id answers 410 for good, with its mark or after its owner deleted the mark, and the
// mark itself can't be edited.
export class RemovedNoteError extends NotefeedError {
  constructor() {
    super("removed", "this note was removed by the operator");
  }
}

// A note whose stored copy does not decrypt (encryption at rest, issue #212): damaged or tampered with, never read as empty. The
// operator gets a log line naming the note (backend/notes.ts).
export class UnreadableNoteError extends NotefeedError {
  constructor() {
    super("unreadable", "the note's stored copy cannot be decrypted");
  }
}

/**
 * The key service (NOTEFEED_KMS, issue #215) does not answer: maintenance, not an error. 503 with Retry-After. Known by its digest
 * (keyServiceDown), not by instanceof: Next may bundle this module once per route, and the wrapper that throws it is shared.
 */
export class KeyServiceUnavailableError extends NotefeedError {
  readonly retryAfter = 30;
  readonly digest = UNAVAILABLE_DIGEST;
  constructor() {
    super("unavailable", "the key service is unreachable");
  }
}

/** Too many images are being processed (backend/imageprocess.ts): 503 with Retry-After, like a rate limit but for everyone. */
export class BusyError extends NotefeedError {
  readonly retryAfter = 5;
  constructor() {
    super("busy", "too many images are being processed, try again shortly");
  }
}

export const keyServiceDown = (e: unknown): e is KeyServiceUnavailableError => (e as { digest?: unknown } | null)?.digest === UNAVAILABLE_DIGEST;
