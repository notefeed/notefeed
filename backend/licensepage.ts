// license.md (ADR 0035): the license page's words that the payment provider does not hold. YAML front matter for the free tile,
// what every plan tile shows and the fine print below the tiles (Markdown), the Markdown body for the intro. A message about a broken file names the field or the line,
// never the file's text: it goes to the log at startup.
import { parse, YAMLParseError } from "yaml";
import { z } from "zod";
import type { LicenseText } from "@/shared/plans";

export class LicensePageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LicensePageError";
  }
}

const feature = z.strictObject({ text: z.string().min(1), included: z.boolean().default(true) });

const shape = z.strictObject({
  free: z.strictObject({
    title: z.string().min(1),
    price: z.union([z.string(), z.number()]).transform(String), // an unquoted `price: 0` is a number to YAML
    note: z.string().optional(),
    features: z.array(feature),
  }),
  plans: z.strictObject({
    badge: z.string().optional(),
    note: z.string().optional(),
    features: z.array(feature),
    button: z.string().min(1),
  }),
  fineprint: z.string().optional(),
});

const FRONT_MATTER = /^---[ \t]*\n([\s\S]*?)^---[ \t]*(?:\n|$)/m;

/** Throws LicensePageError when the file is not front matter of the right shape followed by the intro. */
export function parseLicensePage(markdown: string): LicenseText {
  const text = markdown.replace(/^﻿/, "").replaceAll("\r\n", "\n");
  const m = FRONT_MATTER.exec(text);
  if (!m || m.index !== 0) throw new LicensePageError("license.md has no front matter (--- … ---)");
  let data: unknown;
  try {
    data = parse(m[1]);
  } catch (e) {
    // The parser's own message quotes the lines around the error.
    const line = e instanceof YAMLParseError && e.linePos ? ` (line ${e.linePos[0].line + 1})` : "";
    throw new LicensePageError(`license.md: the front matter is not valid YAML${line}`);
  }
  const result = shape.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new LicensePageError(`license.md: ${issue.path.length ? `${issue.path.join(".")}: ` : ""}${issue.message}`);
  }
  return { ...result.data, intro: text.slice(m[0].length).trim() };
}
