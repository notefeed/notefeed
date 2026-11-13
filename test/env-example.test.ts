import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

// Every setting the app reads is in .env.example, so an operator who copies it sees them all (the deployment convention).
// Not settings, and so not listed: variables of tests and the build, the curl examples' and the CLI's own, ones only
// read to warn that they are gone, names that are not variables at all, and notefeed.me's selling.
const NOT_SETTINGS = new Set([
  "NOTEFEED_COMMIT", // the build
  "NOTEFEED_VERSION", // the build
  "NOTEFEED_FAKE_WEBHOOK_SECRET", // the fake payment provider of tests and development
  "NOTEFEED_FEED", // the CLI's and the curl examples' own
  "NOTEFEED_FEED_PASSWORD", // the curl examples' own
  "NOTEFEED_LICENSE_PRICE", // removed, read only to warn
  "NOTEFEED_LICENSE_PRICE_YEARLY", // removed, read only to warn
  "NOTEFEED_SHRINK_IMAGE_BYTES", // removed, read only to warn
  "NOTEFEED_UNAVAILABLE", // an error digest, not a variable
  // Selling licenses is notefeed.me's alone and stays out of the public docs (ADR 0029, ADR 0032): not listed here either.
  "NOTEFEED_PAYMENT_PROVIDER",
  "NOTEFEED_CREEM_API_KEY",
  "NOTEFEED_CREEM_PRODUCT_ID",
  "NOTEFEED_CREEM_PRODUCT_ID_YEARLY",
  "NOTEFEED_CREEM_WEBHOOK_SECRET",
  "NOTEFEED_LICENSE_FILE",
  "NOTEFEED_LICENSE_DB",
  "NOTEFEED_FREE_NOTE_CAP",
]);

// Where a setting would be read: the app's source, without tests, the docs, the client packages, scripts, tool configs
// and the generated API client.
const NOT_APP_CODE = [
  /(^|\/)(docs|e2e|packages|test|scripts)\//, // not the app
  /\.test\.tsx?$/, // tests
  /\.config\.(ts|mts|mjs)$/, // tool configs (Playwright, Vitest, Next)
  /^app\/_lib\/api\//, // the generated API client
];
function sourceFiles(): string[] {
  const all = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" }).split("\n");
  return all.filter((f) => /\.(ts|tsx|mjs|js)$/.test(f) && !NOT_APP_CODE.some((r) => r.test(f)));
}

test("every NOTEFEED_* setting the app reads is in .env.example", () => {
  const example = readFileSync(".env.example", "utf8");
  const read = new Set<string>();
  for (const f of sourceFiles()) {
    for (const [name] of readFileSync(f, "utf8").matchAll(/\bNOTEFEED_[A-Z0-9_]*[A-Z0-9]\b/g)) read.add(name);
  }
  const missing = [...read].filter((v) => !NOT_SETTINGS.has(v) && !v.startsWith("NOTEFEED_TEST_") && !new RegExp(`\\b${v}=`).test(example));
  expect(missing.sort()).toEqual([]);
});

test("PUID and PGID, read by the image's entrypoint, are in .env.example", () => {
  const example = readFileSync(".env.example", "utf8");
  expect(example).toMatch(/\bPUID=/);
  expect(example).toMatch(/\bPGID=/);
});
