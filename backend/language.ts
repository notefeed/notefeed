// A note's language (ADR 0063): the rule every write path holds it to. Apart from backend/notefields.ts, which lists it with the other
// fields, so that backend/notes.ts can check it without importing that list.
import { LANGUAGE_PATTERN, MAX_LANGUAGE } from "../shared/language";
import { InvalidBodyError } from "./errors";

export { MAX_LANGUAGE };
export const LANGUAGE_RULE = `language must be a BCP 47 language tag (\`de\`, \`en\`, \`pt-BR\`): letters, digits and single hyphens, at most ${MAX_LANGUAGE} characters`;
// A language tag as BCP 47 writes it: the language lower-case, a script (4 letters) title-case, a region (2 letters) upper-case, the rest
// lower-case. undefined stays undefined, "" stays "" (an edit's "remove it"); anything else that is no tag is refused.
const LANGUAGE = new RegExp(`^${LANGUAGE_PATTERN}$`);
export function checkLanguage(value: string | undefined): string | undefined {
  const v = value?.trim();
  if (!v) return v;
  if (v.length > MAX_LANGUAGE || !LANGUAGE.test(v)) throw new InvalidBodyError(LANGUAGE_RULE);
  return v
    .split("-")
    .map((part, i) =>
      i === 0
        ? part.toLowerCase()
        : part.length === 4 && /^[a-z]+$/i.test(part)
          ? part[0].toUpperCase() + part.slice(1).toLowerCase()
          : part.length === 2
            ? part.toUpperCase()
            : part.toLowerCase(),
    )
    .join("-");
}
