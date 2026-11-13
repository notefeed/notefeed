import { tmpdir } from "node:os";
import { expect, test } from "vitest";

// The setup file gives every test its own temporary DATA_DIR, so a test that forgets cannot write to /data or the repo.
test("a test that never sets DATA_DIR gets a temporary one", () => {
  expect(process.env.DATA_DIR).toBeDefined();
  expect(process.env.DATA_DIR!.startsWith(tmpdir())).toBe(true);
});
