// A note's language (ADR 0063), as one rule for the server (backend/language.ts, the real check, which also normalises case) and the
// compose box's field (an HTML `pattern`, which the browser anchors itself; case is left to the server).
export const MAX_LANGUAGE = 35;
// A BCP 47 tag: a language of 2 or 3 letters, then subtags of 1 to 8 letters or digits, each after a single hyphen.
export const LANGUAGE_PATTERN = "[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*";
