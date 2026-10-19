// The imprint, the privacy page and the terms of an instance: Markdown files of the operator's own, named by NOTEFEED_IMPRINT_FILE,
// NOTEFEED_PRIVACY_FILE and NOTEFEED_TERMS_FILE. notefeed ships none of the texts. Without a file, or with one that cannot be read, the page does
// not exist and the footer has no link to it. NOTEFEED_NOTICE_FILE is a file of the same kind: a notice of the operator's on the
// start page, which without a file is as notefeed ships it. NOTEFEED_LICENSE_FILE holds the license page's words (license.md,
// backend/licensepage.ts, ADR 0035), read only while licenses are sold.
import { readFile, stat } from "node:fs/promises";
import type { LicenseText } from "@/shared/plans";
import { config } from "./config";
import { parseLicensePage } from "./licensepage";
import { licensingOn } from "./licensing";

export type LegalPage = "imprint" | "privacy" | "terms";

// A page of text, not a place to keep files: anything larger is a mistake in the setting.
export const MAX_LEGAL_BYTES = 256 * 1024;

type OperatorFile = LegalPage | "notice" | "license";

const SETTINGS: Record<OperatorFile, { name: string; path: () => string }> = {
  imprint: { name: "NOTEFEED_IMPRINT_FILE", path: config.imprintFile },
  privacy: { name: "NOTEFEED_PRIVACY_FILE", path: config.privacyFile },
  terms: { name: "NOTEFEED_TERMS_FILE", path: config.termsFile },
  notice: { name: "NOTEFEED_NOTICE_FILE", path: config.noticeFile },
  license: { name: "NOTEFEED_LICENSE_FILE", path: config.licenseFile },
};

const fileOf = (file: OperatorFile): string => SETTINGS[file].path();

/** The size of the file; null when the setting is empty or does not name a regular file of a sensible size. */
async function sizeOf(file: OperatorFile): Promise<number | null> {
  const path = fileOf(file);
  if (path === "") return null;
  try {
    const info = await stat(/*turbopackIgnore: true*/ path);
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
    return await readFile(/*turbopackIgnore: true*/ fileOf(file), "utf8");
  } catch {
    return null; // removed since the look, or not readable
  }
}

/** What is wrong with the license file, for the startup error: the setting or a field, never the file's text or path. Null when it is usable. */
export async function licensePageProblem(): Promise<string | null> {
  if (config.licenseFile() === "") return "NOTEFEED_LICENSE_FILE is not set";
  const markdown = await read("license");
  if (markdown === null) return "NOTEFEED_LICENSE_FILE names no readable file (missing, not a file, or larger than 256 KiB)";
  try {
    parseLicensePage(markdown);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "license.md cannot be read";
  }
}

/** The license file's words, read on every request; null when it is missing, unreadable or broken. */
export async function readLicensePage(): Promise<LicenseText | null> {
  const markdown = await read("license");
  if (markdown === null) return null;
  try {
    return parseLicensePage(markdown);
  } catch {
    return null;
  }
}

/** Whether /license exists, and with it every link to it: a payment provider is set and its license file is usable. Without a provider the file is not read. */
export const licensePageOn = async (): Promise<boolean> => licensingOn() && (await readLicensePage()) !== null;

/** For the startup log: the settings that are set but name nothing readable (the variable's name, never the path). The license
 *  file is left to the startup check, which refuses to start without it while licenses are sold and ignores it otherwise. */
export async function unreadableLegalSettings(): Promise<string[]> {
  const out: string[] = [];
  for (const file of (Object.keys(SETTINGS) as OperatorFile[]).filter((f) => f !== "license"))
    if (fileOf(file) !== "" && (await sizeOf(file)) === null) out.push(SETTINGS[file].name);
  return out;
}
