// The operator's own pages (ADR 0035): Markdown files in one folder, NOTEFEED_PAGES_DIR, under fixed names. imprint.md, privacy.md
// and terms.md are the pages /imprint, /privacy and /terms; notice.md is a notice on the start page; license.md holds the license
// page's words (backend/licensepage.ts). No other file in the folder is read. notefeed ships none of the texts: without a file, or
// with one that cannot be read, the page does not exist and nothing links to it.
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { LicenseText } from "@/shared/plans";
import { config } from "./config";
import { parseLicensePage } from "./licensepage";
import { licensingOn } from "./licensing";

export type LegalPage = "imprint" | "privacy" | "terms";

// A page of text, not a place to keep files: anything larger is a mistake.
export const MAX_LEGAL_BYTES = 256 * 1024;

type OperatorFile = LegalPage | "notice" | "license";
const FILES: OperatorFile[] = ["imprint", "privacy", "terms", "notice", "license"];

const pathOf = (file: OperatorFile): string => join(/*turbopackIgnore: true*/ config.pagesDir(), `${file}.md`);

/** The size of the file; null without a folder, or when the file is no regular file of a sensible size. */
async function sizeOf(file: OperatorFile): Promise<number | null> {
  if (config.pagesDir() === "") return null;
  try {
    const info = await stat(/*turbopackIgnore: true*/ pathOf(file));
    return info.isFile() && info.size <= MAX_LEGAL_BYTES ? info.size : null;
  } catch {
    return null;
  }
}

/** Whether the page exists on this instance, for the footer's link. */
export const hasLegalPage = async (page: LegalPage): Promise<boolean> => (await sizeOf(page)) !== null;

/** The page's Markdown, read on every request so an edited file shows at once; null when the page does not exist. */
export const readLegalPage = (page: LegalPage): Promise<string | null> => read(page);

/** The notice for the start page, read on every request like a page; null without a file or when it holds no text. */
export async function readNotice(): Promise<string | null> {
  const markdown = await read("notice");
  return markdown === null || markdown.trim() === "" ? null : markdown;
}

async function read(file: OperatorFile): Promise<string | null> {
  if ((await sizeOf(file)) === null) return null;
  try {
    return await readFile(/*turbopackIgnore: true*/ pathOf(file), "utf8");
  } catch {
    return null; // removed since the look, or not readable
  }
}

/** What is wrong with license.md, for the startup error: a setting or field, never the file's text. Null when it is usable. */
export async function licensePageProblem(): Promise<string | null> {
  if (config.pagesDir() === "") return "NOTEFEED_PAGES_DIR is not set";
  const markdown = await read("license");
  if (markdown === null) return "NOTEFEED_PAGES_DIR has no readable license.md (missing, not a file, or larger than 256 KiB)";
  try {
    parseLicensePage(markdown);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "license.md cannot be read";
  }
}

/** license.md's words, read on every request; null when the file is missing, unreadable or broken. */
export async function readLicensePage(): Promise<LicenseText | null> {
  const markdown = await read("license");
  if (markdown === null) return null;
  try {
    return parseLicensePage(markdown);
  } catch {
    return null;
  }
}

/** Whether /license exists, and with it every link to it: a payment provider is set and license.md is usable. Without a provider license.md is not read. */
export const licensePageOn = async (): Promise<boolean> => licensingOn() && (await readLicensePage()) !== null;

/** For the startup log: the folder when it is set but is none, else each of the five files that exists but cannot be shown (names only, never the path). */
export async function pagesDirWarnings(): Promise<{ setting?: string; file?: string }[]> {
  const dir = config.pagesDir();
  if (dir === "") return [];
  try {
    if (!(await stat(/*turbopackIgnore: true*/ dir)).isDirectory()) return [{ setting: "NOTEFEED_PAGES_DIR" }];
  } catch {
    return [{ setting: "NOTEFEED_PAGES_DIR" }];
  }
  const out: { file: string }[] = [];
  for (const file of FILES) {
    const exists = await stat(/*turbopackIgnore: true*/ pathOf(file)).then(() => true, () => false);
    if (exists && (await sizeOf(file)) === null) out.push({ file: `${file}.md` });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}
