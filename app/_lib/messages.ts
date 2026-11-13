// The web UI's wording for the backend's error codes (shared/errors.ts), from a form post's ?error=&retry= or a fetch() error body,
// in the page's language (#352): messagesFor(copy) gives the functions with that language's words. Runs on the server and in the
// browser: a server component passes await serverCopy(), a client one useCopy().
import type { Copy } from "@/shared/copy";
import type { ErrorCode } from "@/shared/errors";
import { MAX_ATTACHMENTS } from "@/shared/links";
import { PASSWORD_RULE } from "@/shared/password";

type Message = (code: unknown, retry?: unknown) => string | undefined;

// A title or an alt text refused for holding a control or text-direction override character (a title pasted from Word with a line
// separator, say): worded to point at it, from the server's own message (backend/notes.ts checkLine).
const LINE_REFUSED = /^(title|alt) must be one line, without control or text-direction override characters/;
// The post that creates a protected feed brought a license key the server does not know (backend/licenseflow.ts checkLicenseKey).
const KEY_REFUSED = "that is not a license key";

export function messagesFor(t: Copy) {
  const e = t.errors;
  // sign_in_failed is no API code: only the OIDC callback's ?error= (backend/oidc/routes.ts).
  const MESSAGES: Record<ErrorCode | "sign_in_failed", string> = { ...e.codes, images_off: e.imagesOff, unreadable: e.unreadable, unavailable: e.maintenance };

  // undefined for no code; an unknown code still says something.
  const errorMessage: Message = (code, retry) => {
    if (typeof code !== "string" || code === "") return undefined;
    const text = Object.hasOwn(MESSAGES, code) ? MESSAGES[code as keyof typeof MESSAGES] : e.somethingWrong; // not `in`/`??`: "constructor" is inherited
    return text.replace("{retry}", /^\d+$/.test(String(retry)) ? String(retry) : e.fewSeconds);
  };

  // On a note page, where "auth" is a form refused for coming from outside (no feed or instance password involved).
  const noteErrorMessage: Message = (code, retry) => (code === "auth" ? e.note.auth : errorMessage(code, retry));

  // For an image upload, where "too_large" and "unsupported_type" are about the image, "auth" about a login that has lapsed, and
  // "not_found" about a feed that cannot take images (no note yet, or no read link).
  const imageErrorMessage: Message = (code, retry) =>
    Object.hasOwn(e.image, String(code)) ? e.image[code as keyof typeof e.image] : errorMessage(code, retry);

  const lineRefusal = (code: unknown, detail: string | undefined) => {
    const field = code === "invalid_body" ? LINE_REFUSED.exec(detail ?? "")?.[1] : undefined;
    return field && e.line(field as "title" | "alt");
  };
  const keyRefusal = (code: unknown, detail: string | undefined) => (code === "invalid_body" && detail === KEY_REFUSED ? e.notAKey : undefined);

  return {
    // Under a new-password field, and what the browser says when the field's pattern doesn't match.
    PASSWORD_HINT: e.passwordHint(PASSWORD_RULE),
    // Under the sign-in button and the compose box while sign-in is on.
    SENDER_NOTICE: e.senderNotice,
    // In a note box, when more pictures are dropped, pasted or picked than a note takes: the ones that fit are added.
    TOO_MANY_PICTURES: e.tooManyPictures(MAX_ATTACHMENTS),
    // In a note box instead of the "Add image" button while NOTEFEED_IMAGE_UPLOADS=0, and the server's refusal of an image.
    IMAGES_OFF: e.imagesOff,
    // A damaged note (encryption at rest, issue #212), where it is listed and on its own page.
    UNREADABLE: e.unreadable,
    // The key service is unreachable (#215): on the maintenance page and under a form.
    MAINTENANCE: e.maintenance,
    errorMessage,
    noteErrorMessage,
    imageErrorMessage,

    // On the feed password screens, where "auth" and "invalid_body" are about a feed password.
    feedErrorMessage: ((code, retry) =>
      code === "auth" ? e.feed.auth : code === "invalid_body" ? e.feed.newPassword(PASSWORD_RULE) : errorMessage(code, retry)) as Message,

    // Recovering a feed password with the feed's license key (ADR 0037).
    recoverErrorMessage: ((code, retry) =>
      code === "auth"
        ? e.recover.auth
        : code === "license_required"
          ? e.recover.licenseRequired
          : code === "invalid_body"
            ? e.feed.newPassword(PASSWORD_RULE)
            : errorMessage(code, retry)) as Message,

    // The new feed's "Create feed without a note" (#295).
    createErrorMessage: ((code, retry) =>
      code === "license_required"
        ? e.create.licenseRequired
        : code === "feed_exists"
          ? e.create.exists
          : code === "invalid_body"
            ? e.create.invalid(PASSWORD_RULE)
            : errorMessage(code, retry)) as Message,

    // What a password change on the settings page just did (#296), shown in the password row.
    passwordNotice: (saved: unknown): string | undefined => {
      const done =
        saved === "password-set"
          ? e.passwordSaved.set
          : saved === "password-changed"
            ? e.passwordSaved.changed
            : saved === "password-recovered"
              ? e.passwordSaved.recovered
              : undefined;
      return done && `${done} ${e.passwordSaved.others}`;
    },

    // Giving an open feed a password (ADR 0044).
    protectErrorMessage: ((code, retry) =>
      code === "auth"
        ? e.protect.auth
        : code === "license_required"
          ? e.protect.licenseRequired
          : code === "invalid_body"
            ? e.protect.invalid(PASSWORD_RULE)
            : errorMessage(code, retry)) as Message,

    // The feed's settings and delete forms, which send a title and a description or the typed name.
    feedDetailsErrorMessage: ((code, retry) =>
      code === "invalid_body" ? e.details.invalid : code === "invalid_request" ? e.details.confirm : noteErrorMessage(code, retry)) as Message,

    // A note sent with its pictures: a refusal that names a picture (`attachment "a.png": …`) is worded as an image refusal, after
    // the picture's name; any other goes to `message`, except a "too_large" that names no picture when the request had pictures
    // (`pictures`). That has two causes: the text is over 100 KB, or one picture is so far over its limit that the server stopped
    // reading the request before it could name it.
    withPictures:
      (message: Message, pictures = false) =>
      (code: unknown, retry?: unknown, detail?: string): string | undefined => {
        const named = /^attachment "(.*)": (.*)$/s.exec(detail ?? "");
        if (named) return `${named[1]}: ${lineRefusal(code, named[2]) ?? imageErrorMessage(code, retry)}`;
        const line = lineRefusal(code, detail) ?? keyRefusal(code, detail);
        if (line) return line;
        return pictures && code === "too_large" ? e.tooLargeWithPictures : message(code, retry);
      },
  };
}

export type Messages = ReturnType<typeof messagesFor>;
