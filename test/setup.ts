import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";

// Every test gets its own temporary DATA_DIR, removed afterwards: a test that forgets to set one never touches /data or the repo.
// A test that sets DATA_DIR itself still wins; its own directory is its own to clean up.
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "notefeed-test-"));
  process.env.DATA_DIR = dir;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});
