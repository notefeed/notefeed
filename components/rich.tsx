import { Fragment, type ReactNode } from "react";

// A sentence of the copy (shared/copy) with the little markup it may carry (#352): **bold** for a button or menu a person looks for,
// `code` for a name or value to type. Everything else stays text, so a translation moves the emphasis with the words.
export function rich(text: string, { strong = "text-ink", code = "break-all font-mono" }: { strong?: string; code?: string } = {}): ReactNode {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={i} className={strong}>
        {part.slice(2, -2)}
      </strong>
    ) : part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
      <code key={i} className={code}>
        {part.slice(1, -1)}
      </code>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}
