// The web UI's wording for the backend's error codes (shared/errors.ts), from a form post's
// ?error=&retry= or a fetch() error body. Runs on the server and in the browser.
import type { ErrorCode } from "@/shared/errors";
import { MAX_ATTACHMENTS } from "@/shared/links";
import { PASSWORD_RULE } from "@/shared/password";

// Under a new-password field, and what the browser says when the field's pattern doesn't match.
export const PASSWORD_HINT = `Use ${PASSWORD_RULE}: unaccented letters, digits and symbols.`;

// Under the sign-in button and the compose box while sign-in is on.
export const SENDER_NOTICE = "Your name is shown on your notes, including on the public read link and RSS.";

// In a note box, when more pictures are dropped, pasted or picked than a note takes: the ones that fit are added.
export const TOO_MANY_PICTURES = `A note can have at most ${MAX_ATTACHMENTS} pictures.`;

// In a note box instead of the "Add image" button while NOTEFEED_IMAGE_UPLOADS=0, and the server's refusal of an image.
export const IMAGES_OFF = "Images can't be posted on this instance.";

// A damaged note (encryption at rest, issue #212), where it is listed and on its own page.
export const UNREADABLE = "This note can't be shown: its stored copy can't be decrypted.";

// The key service is unreachable (#215): on the maintenance page and under a form.
export const MAINTENANCE = "notefeed is down for maintenance. Please try again in a few minutes.";

// sign_in_failed is no API code: only the OIDC callback's ?error= (backend/oidc/routes.ts).
const MESSAGES: Record<ErrorCode | "sign_in_failed", string> = {
  invalid_feed: "Invalid feed name.",
  reserved_feed: "That feed name is reserved.",
  auth: "That password doesn't match NOTEFEED_PASSWORD.",
  rate_limited: "Too many requests, try again in {retry} seconds.",
  too_many_attempts: "Too many attempts, try again in {retry} seconds.",
  feed_limit: "This instance has reached its feed limit.",
  note_limit: "This feed has reached its note limit.",
  image_limit: "This feed has reached its image limit.",
  images_off: IMAGES_OFF,
  license_required: "This needs a license for the feed.",
  empty_note: "The note is empty.",
  too_large: "The note is over 100 KB.",
  unsupported_type: "The note could not be read.",
  invalid_body: "The note could not be read.",
  invalid_request: "Something went wrong.",
  not_found: "Not found.",
  feed_exists: "This feed already exists, so it can't be given a password.",
  taken: "That read id is taken. Choose another.",
  removed: "This feed was removed by the operator. Its name can't be used again.",
  blocked: "This image may not be posted here.",
  unreadable: UNREADABLE,
  unavailable: MAINTENANCE,
  busy: "notefeed is busy with other pictures. Try again in {retry} seconds.",
  sign_in_failed: "Sign-in didn't work. Try again.",
};

// undefined for no code; an unknown code still says something.
export function errorMessage(code: unknown, retry?: unknown): string | undefined {
  if (typeof code !== "string" || code === "") return undefined;
  const text = Object.hasOwn(MESSAGES, code) ? MESSAGES[code as keyof typeof MESSAGES] : "Something went wrong."; // not `in`/`??`: "constructor" is inherited
  return text.replace("{retry}", /^\d+$/.test(String(retry)) ? String(retry) : "a few");
}

// The same, on the feed password screens, where "auth" and "invalid_body" are about a feed password.
export function feedErrorMessage(code: unknown, retry?: unknown): string | undefined {
  if (code === "auth") return "That password is wrong.";
  if (code === "invalid_body") return `The new password must be ${PASSWORD_RULE}.`;
  return errorMessage(code, retry);
}

// The same, for recovering a feed password with the feed's license key (ADR 0037).
export function recoverErrorMessage(code: unknown, retry?: unknown): string | undefined {
  if (code === "auth") return "That is not the license key of this feed.";
  if (code === "license_required") return "A new password needs an active license. Leave the new password empty to remove the password instead.";
  if (code === "invalid_body") return `The new password must be ${PASSWORD_RULE}.`;
  return errorMessage(code, retry);
}

// The same, for giving an open feed a password (ADR 0044).
// The new feed's "Create feed without a note" (#295).
export function createErrorMessage(code: unknown, retry?: unknown): string | undefined {
  if (code === "license_required") return "Creating a feed without a note needs a license key: enter one above.";
  if (code === "feed_exists") return "This feed exists already.";
  if (code === "invalid_body") return `The password must be ${PASSWORD_RULE}, and the license key a valid one.`;
  return errorMessage(code, retry);
}

// What a password change on the settings page just did (#296), shown in the password row.
export function passwordNotice(saved: unknown): string | undefined {
  const others = "Scripts and other browsers need the new password from now on; this browser stays unlocked.";
  if (saved === "password-set") return `Password set. ${others}`;
  if (saved === "password-changed") return `Password changed. ${others}`;
  if (saved === "password-recovered") return `New password set with the license key. ${others}`;
  return undefined;
}

export function protectErrorMessage(code: unknown, retry?: unknown): string | undefined {
  if (code === "auth") return "Someone has set a password on this feed meanwhile.";
  if (code === "license_required") return "A feed password needs a license: put one on this feed under License first.";
  if (code === "invalid_body") return `The password must be ${PASSWORD_RULE}.`;
  return errorMessage(code, retry);
}

// The same, for the feed's settings and delete forms, which send a title and a description or the typed name.
export function feedDetailsErrorMessage(code: unknown, retry?: unknown): string | undefined {
  if (code === "invalid_body") return "The title, description or read id is too long or too short, or has characters that aren't allowed.";
  if (code === "invalid_request") return "Type the feed's name to confirm.";
  return noteErrorMessage(code, retry);
}

// The same, on a note page, where "auth" is a form refused for coming from outside (no feed or instance password involved).
export function noteErrorMessage(code: unknown, retry?: unknown): string | undefined {
  return code === "auth" ? "That didn't work. Reload the page and try again." : errorMessage(code, retry);
}

// The same, for an image upload, where "too_large" and "unsupported_type" are about the image, "auth" about a login that has
// lapsed, and "not_found" about a feed that cannot take images (no note yet, or no read link).
export function imageErrorMessage(code: unknown, retry?: unknown): string | undefined {
  const own: Record<string, string> = {
    too_large: "That image is too large.",
    unsupported_type: "Only PNG, JPEG, GIF and WebP images can be added.",
    auth: "You are not signed in for this feed. Reload the page and try again.",
    not_found: "Images can't be added to this feed yet.",
  };
  return own[String(code)] ?? errorMessage(code, retry);
}

// A title or an alt text refused for holding a control or text-direction override character (a title pasted from Word with a line
// separator, say): worded to point at it, from the server's own message (backend/notes.ts checkLine).
const LINE_REFUSED = /^(title|alt) must be one line, without control or text-direction override characters/;
function lineRefusal(code: unknown, detail: string | undefined): string | undefined {
  const field = code === "invalid_body" ? LINE_REFUSED.exec(detail ?? "")?.[1] : undefined;
  return field && `The ${field === "alt" ? "alt text" : "title"} must be one line, without control or text-direction override characters.`;
}

// The post that creates a protected feed brought a license key the server does not know (backend/licenseflow.ts checkLicenseKey).
const KEY_REFUSED = "that is not a license key";
const keyRefusal = (code: unknown, detail: string | undefined) => (code === "invalid_body" && detail === KEY_REFUSED ? "That is not a license key. Check it against the key from your purchase." : undefined);

// The same, for a note sent with its pictures: a refusal that names a picture (`attachment "a.png": …`) is worded as an image
// refusal, after the picture's name; any other goes to `message`, except a "too_large" that names no picture when the request had
// pictures (`pictures`). That has two causes: the text is over 100 KB, or one picture is so far over its limit that the server stopped
// reading the request before it could name it.
export const withPictures =
  (message: (code: unknown, retry?: unknown) => string | undefined, pictures = false) =>
  (code: unknown, retry?: unknown, detail?: string): string | undefined => {
    const named = /^attachment "(.*)": (.*)$/s.exec(detail ?? "");
    if (named) return `${named[1]}: ${lineRefusal(code, named[2]) ?? imageErrorMessage(code, retry)}`;
    const line = lineRefusal(code, detail) ?? keyRefusal(code, detail);
    if (line) return line;
    return pictures && code === "too_large" ? "The note is too large: its text is over 100 KB, or a picture is too large." : message(code, retry);
  };
