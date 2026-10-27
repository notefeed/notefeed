import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { footerLinks } from "@/components/LegalLinks";

// The license page's words, as the operator writes them (backend/licensepage.fixture.ts in short).
const LICENSE = "---\nfree:\n  title: Free\n  price: 0\n  features: []\nplans:\n  features: []\n  button: Buy\n---\n";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "notefeed-footer-"));
  vi.stubEnv("NOTEFEED_LICENSE_FILE", join(dir, "license.md"));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
const hasLicense = async () => (await footerLinks()).product.some((l) => l.href === "/license");

test("the License link is there while licenses are sold and license.md is usable", async () => {
  await writeFile(join(dir, "license.md"), LICENSE);
  expect(await hasLicense()).toBe(false); // no provider
  vi.stubEnv("NOTEFEED_PAYMENT_PROVIDER", "fake");
  vi.stubEnv("NOTEFEED_FAKE_WEBHOOK_SECRET", "s");
  expect(await hasLicense()).toBe(true);
  await writeFile(join(dir, "license.md"), "broken");
  expect(await hasLicense()).toBe(false);
  await rm(join(dir, "license.md"));
  expect(await hasLicense()).toBe(false);
});

test("the support address is a Support link after the legal pages", async () => {
  await writeFile(join(dir, "imprint.md"), "# Imprint");
  vi.stubEnv("NOTEFEED_IMPRINT_FILE", join(dir, "imprint.md"));
  vi.stubEnv("NOTEFEED_SUPPORT_EMAIL", " support@example.com ");
  const { legal } = await footerLinks();
  expect(legal.map((l) => l.label)).toEqual(["Imprint", "Support"]);
  expect(legal.at(-1)).toEqual({ href: "mailto:support@example.com", label: "Support", external: true });
});

test("a support address that is not one gives no link", async () => {
  for (const v of ["support", "a b@example.com", "a@example.com?subject=x", "a@b@example.com", ""]) {
    vi.stubEnv("NOTEFEED_SUPPORT_EMAIL", v);
    expect((await footerLinks()).legal.find((l) => l.label === "Support")).toBeUndefined();
  }
});

test("the feeds the operator lists come after the product links; other reserved feeds do not", async () => {
  vi.stubEnv("DATA_DIR", dir);
  vi.stubEnv("NOTEFEED_RESERVED_FEEDS", "releases,admin,blog,www");
  vi.stubEnv("NOTEFEED_FOOTER_FEEDS", "releases,blog");
  vi.stubEnv("NOTEFEED_RESERVED_PASSWORD", "operator-pass-1");
  expect((await footerLinks()).product.map((l) => l.label)).toEqual(["Docs", "GitHub", "Releases", "Blog"]);
});
