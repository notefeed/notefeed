import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MAX_LEGAL_BYTES, hasLegalPage, licensePageOn, licensePageProblem, pagesDirWarnings, readLegalPage, readLicensePage, readNotice } from "./legal";
import { VALID_LICENSE } from "./licensepage.fixture";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "notefeed-legal-"));
  vi.stubEnv("NOTEFEED_PAGES_DIR", dir);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

test("without NOTEFEED_PAGES_DIR there is no page, no notice and no license page", async () => {
  await writeFile(join(dir, "imprint.md"), "# Imprint");
  vi.stubEnv("NOTEFEED_PAGES_DIR", "");
  for (const page of ["imprint", "privacy", "terms"] as const) {
    expect(await hasLegalPage(page)).toBe(false);
    expect(await readLegalPage(page)).toBeNull();
  }
  expect(await readNotice()).toBeNull();
  expect(await readLicensePage()).toBeNull();
  expect(await pagesDirWarnings()).toEqual([]);
});

test("each page is its own file in the folder, read as it is", async () => {
  await writeFile(join(dir, "imprint.md"), "# Imprint\n\nJane Doe, Musterstraße 1");
  await writeFile(join(dir, "privacy.md"), "# Privacy\n\n<b>not html</b> ünïcödé");
  expect(await hasLegalPage("imprint")).toBe(true);
  expect(await readLegalPage("imprint")).toBe("# Imprint\n\nJane Doe, Musterstraße 1");
  expect(await readLegalPage("privacy")).toBe("# Privacy\n\n<b>not html</b> ünïcödé");
  expect(await hasLegalPage("terms")).toBe(false); // a missing file is no page, and no mistake
  expect(await pagesDirWarnings()).toEqual([]);
});

test("only the five names are read: another file in the folder does nothing", async () => {
  await writeFile(join(dir, "faq.md"), "# FAQ");
  await writeFile(join(dir, "imprint.md"), "# I");
  expect(await hasLegalPage("imprint")).toBe(true);
  expect(await pagesDirWarnings()).toEqual([]);
});

test("an edited file shows at once", async () => {
  await writeFile(join(dir, "privacy.md"), "one");
  expect(await readLegalPage("privacy")).toBe("one");
  await writeFile(join(dir, "privacy.md"), "two");
  expect(await readLegalPage("privacy")).toBe("two");
});

test("a folder or a file that is too large gives no page", async () => {
  await mkdir(join(dir, "terms.md"));
  await writeFile(join(dir, "privacy.md"), "x".repeat(MAX_LEGAL_BYTES + 1));
  await writeFile(join(dir, "imprint.md"), "x".repeat(MAX_LEGAL_BYTES));
  expect(await hasLegalPage("terms")).toBe(false);
  expect(await readLegalPage("privacy")).toBeNull();
  expect(await hasLegalPage("imprint")).toBe(true);
});

test("a folder that is not one is a warning naming the setting", async () => {
  vi.stubEnv("NOTEFEED_PAGES_DIR", join(dir, "nope"));
  expect(await pagesDirWarnings()).toEqual([{ setting: "NOTEFEED_PAGES_DIR" }]);
  await writeFile(join(dir, "file"), "x");
  vi.stubEnv("NOTEFEED_PAGES_DIR", join(dir, "file"));
  expect(await pagesDirWarnings()).toEqual([{ setting: "NOTEFEED_PAGES_DIR" }]);
});

test("a page file that cannot be shown is a warning naming the file", async () => {
  await mkdir(join(dir, "terms.md"));
  await writeFile(join(dir, "privacy.md"), "x".repeat(MAX_LEGAL_BYTES + 1));
  const warnings = await pagesDirWarnings();
  expect(warnings).toEqual([{ file: "privacy.md" }, { file: "terms.md" }]);
  expect(JSON.stringify(warnings)).not.toContain(dir);
});

test("a link to a file is followed: the operator chose it", async () => {
  await writeFile(join(dir, "real.md"), "linked");
  await symlink(join(dir, "real.md"), join(dir, "imprint.md"));
  expect(await readLegalPage("imprint")).toBe("linked");
});

test("the notice is its own file, and there is none without the file or without text in it", async () => {
  expect(await readNotice()).toBeNull();
  await writeFile(join(dir, "notice.md"), " \n\n");
  expect(await readNotice()).toBeNull(); // emptied to take the notice down
  await writeFile(join(dir, "notice.md"), "**Beta.** No promise of availability.\n");
  expect(await readNotice()).toBe("**Beta.** No promise of availability.\n");
  await writeFile(join(dir, "notice.md"), "x".repeat(MAX_LEGAL_BYTES + 1));
  expect(await readNotice()).toBeNull();
});

test("the license page: on with a provider and a valid license.md, off otherwise", async () => {
  await writeFile(join(dir, "license.md"), VALID_LICENSE);
  expect(await licensePageOn()).toBe(false); // no provider
  vi.stubEnv("NOTEFEED_PAYMENT_PROVIDER", "fake");
  vi.stubEnv("NOTEFEED_FAKE_WEBHOOK_SECRET", "s");
  expect(await licensePageOn()).toBe(true);
  expect(await licensePageProblem()).toBeNull();
  expect((await readLicensePage())?.plans.button).toBe("Subscribe");
  await writeFile(join(dir, "license.md"), "no front matter");
  expect(await licensePageOn()).toBe(false);
  expect(await readLicensePage()).toBeNull();
  expect(await licensePageProblem()).toMatch(/^license\.md has no front matter/);
  await rm(join(dir, "license.md"));
  expect(await licensePageProblem()).toMatch(/has no readable license\.md/);
  vi.stubEnv("NOTEFEED_PAGES_DIR", "");
  expect(await licensePageProblem()).toBe("NOTEFEED_PAGES_DIR is not set");
});
